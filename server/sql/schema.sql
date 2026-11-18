CREATE DATABASE IF NOT EXISTS nexa_p2p CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE nexa_p2p;

CREATE TABLE IF NOT EXISTS users (
 id INT PRIMARY KEY AUTO_INCREMENT,
 username VARCHAR(40) NOT NULL UNIQUE,
 display_name VARCHAR(80) NOT NULL,
 password_hash VARCHAR(255) NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS contacts (
 owner_id INT NOT NULL,
 contact_id INT NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (owner_id, contact_id),
 FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(contact_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS conversations (
 id INT PRIMARY KEY AUTO_INCREMENT,
 type ENUM('direct','group') NOT NULL,
 title VARCHAR(100) NULL,
 created_by INT NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS conversation_members (
 conversation_id INT NOT NULL,
 user_id INT NOT NULL,
 PRIMARY KEY(conversation_id,user_id),
 FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS messages (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 uuid CHAR(36) NOT NULL UNIQUE,
 conversation_id INT NOT NULL,
 sender_id INT NOT NULL,
 kind ENUM('text','voice','file') DEFAULT 'text',
 body TEXT NOT NULL,
 reply_to CHAR(36) NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_conversation_messages(conversation_id,id),
 FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
 FOREIGN KEY(sender_id) REFERENCES users(id)
);
