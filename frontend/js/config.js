// 프론트엔드를 백엔드와 다른 곳에 배포할 때 게임 서버 주소를 지정한다.
// 비워 두면 페이지를 연 주소의 /ws 로 접속한다. (주소창의 ?server=wss://... 로도 바꿀 수 있음)
window.GHOST_SERVER_URL = '';
// 음성 채팅 연결용 ICE 서버. 비워 두면 공개 STUN 서버를 쓴다.
// 직접 연결이 안 되는 망에서는 TURN 서버를 넣는다. 예: [{ urls: 'turn:turn.example.com:3478', username: '...', credential: '...' }]
window.GHOST_ICE_SERVERS = null;
