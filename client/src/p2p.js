// One link per remote user. Roles are stable across simultaneous offers.
export class PeerLink {
  constructor({userId, localId, iceServers, signal, receive, status}) {
    Object.assign(this, {userId, signal, receive, status});
    this.polite = localId > userId;
    this.pc = new RTCPeerConnection({iceServers});
    this.channel = null;
    this.channels = new Set();
    this.queue = Promise.resolve();
    this.candidates = [];
    this.attempts = 0;
    this.lastError = null;
    this.closed = false;
    this.pc.onicecandidate = ({candidate}) => candidate && signal('ice', candidate.toJSON());
    this.pc.ondatachannel = ({channel}) => this.attach(channel);
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (!this.closed) signal(this.pc.localDescription.type, this.pc.localDescription.toJSON());
      } catch (e) { if (!this.closed) this.fail(e); }
      finally { this.makingOffer = false; }
    };
    this.pc.onconnectionstatechange = () => {
      if (this.closed) return;
      status(this.channel?.readyState === 'open' ? 'connected' : this.pc.connectionState);
      if (['failed','disconnected'].includes(this.pc.connectionState)) {
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
          if (!this.closed && this.pc.connectionState !== 'connected' && this.attempts < 3) {
            this.attempts++;
            this.pc.restartIce();
            status('reconnecting');
          }
        }, 2000);
      }
    };
  }
  fail(e) { this.lastError = e.message; console.warn('[NEXA WebRTC]',this.userId,e.message); this.status('error'); }
  start() {
    // Only the smaller user ID creates the channel; the polite endpoint receives it.
    // This also avoids two SCTP channels when both conversation views open together.
    if (!this.polite && !this.channel && !this.closed) this.attach(this.pc.createDataChannel('nexa-chat', {ordered:true}));
    if(!this.watchdog)this.watchdog=setTimeout(()=>{
      this.watchdog=null;
      if(!this.closed&&this.channel?.readyState!=='open'){
        this.fail(new Error('Connection timeout; periksa jaringan atau konfigurasi TURN.'));
      }
    },15000);
  }
  attach(channel) {
    this.channels.add(channel);
    if (!this.channel || this.channel.readyState !== 'open') this.channel = channel;
    channel.bufferedAmountLowThreshold = 65536;
    channel.onopen = () => {
      if (this.closed) return;
      clearTimeout(this.watchdog);this.watchdog=null;
      // Glare may negotiate two channels. Both endpoints keep the same SCTP id.
      const open=[...this.channels].filter(c=>c.readyState==='open').sort((a,b)=>a.id-b.id);
      this.channel=open[0];
      for(const other of open.slice(1))other.close();
      this.status('connected');
    };
    channel.onclose = () => { if (!this.closed && this.channel === channel) this.status('disconnected'); };
    channel.onerror = () => { if (!this.closed) this.fail(new Error('DataChannel error')); };
    channel.onmessage = e => {
      if (!this.closed) Promise.resolve(this.receive(e.data)).catch(e => this.fail(e));
    };
  }
  handleSignal(kind, data) {
    this.queue = this.queue.then(async () => {
      if (this.closed) return;
      if (kind === 'ice') {
        if (this.ignoreOffer) return;
        if (this.pc.remoteDescription) {
          const ufrag = this.pc.remoteDescription.sdp.match(/a=ice-ufrag:([^\r\n]+)/)?.[1];
          if (!data.usernameFragment || !ufrag || data.usernameFragment === ufrag) await this.pc.addIceCandidate(data);
        } else if (this.candidates.length < 128) this.candidates.push(data);
        return;
      }
      const collision = kind === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable');
      this.ignoreOffer = !this.polite && collision;
      if (this.ignoreOffer) { this.candidates = []; return; }
      if (kind === 'answer' && this.pc.signalingState !== 'have-local-offer') return;
      await this.pc.setRemoteDescription(data); // polite peer automatically rolls back on glare
      const ufrag = data.sdp.match(/a=ice-ufrag:([^\r\n]+)/)?.[1];
      for (const c of this.candidates.splice(0)) {
        if (!c.usernameFragment || !ufrag || c.usernameFragment === ufrag) await this.pc.addIceCandidate(c);
      }
      if (kind === 'offer') {
        await this.pc.setLocalDescription();
        if (!this.closed) this.signal('answer', this.pc.localDescription.toJSON());
      }
    }).catch(e => { if (!this.closed) this.fail(e); });
    return this.queue;
  }
  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.watchdog);
    this.candidates = [];
    for(const channel of this.channels)channel.close();
    this.channels.clear();
    this.pc.close();
  }
}

export function summarizeStats(report) {
  const rows = [...report.values()];
  const transport = rows.find(r => r.type === 'transport' && r.selectedCandidatePairId);
  const pair = transport ? report.get(transport.selectedCandidatePairId) : null;
  const local = pair && report.get(pair.localCandidateId);
  const remote = pair && report.get(pair.remoteCandidateId);
  const channels = rows.filter(r => r.type === 'data-channel');
  return {
    sent: channels.length ? channels.reduce((n,r) => n + (r.bytesSent || 0),0) : null,
    received: channels.length ? channels.reduce((n,r) => n + (r.bytesReceived || 0),0) : null,
    rtt: pair?.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
    route: pair ? `${local?.candidateType || 'N/A'} → ${remote?.candidateType || 'N/A'}` : 'N/A',
    pair: pair?.id || 'N/A'
  };
}

export const validUuid = x => typeof x === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(x);
export async function checksum(dataUrl) {
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',')+1)), c => c.charCodeAt(0));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return {size:bytes.length, hash:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')};
}
