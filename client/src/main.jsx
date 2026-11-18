import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.jsx';
import './style.css';
class AppBoundary extends React.Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<div role="alert" style={{padding:32,fontFamily:'sans-serif'}}><h1>NEXA perlu dimuat ulang</h1><p>Terjadi kesalahan tampilan. Riwayat yang tersimpan tetap tersedia setelah login.</p><button onClick={()=>window.location.reload()}>Muat ulang</button></div>:this.props.children;}
}
createRoot(document.getElementById('root')).render(<AppBoundary><App/></AppBoundary>);
