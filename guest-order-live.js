/* Supabase Broadcast carries only an invalidation signal. Order data stays behind table-api. */
(function(root){
  class GuestOrderLive {
    constructor({url,key,tableToken,onChange,onConnection}) {
      this.url=url;this.key=key;this.topic='realtime:table-orders:'+tableToken;
      this.onChange=onChange;this.onConnection=onConnection;
      this.socket=null;this.active=false;this.ref=0;this.retry=0;
    }
    start(){if(this.active)return;this.active=true;this.connect();}
    stop(){
      this.active=false;this.pendingHeartbeat=null;this.joinRef=null;clearTimeout(this.reconnectTimer);clearTimeout(this.joinTimer);clearInterval(this.heartbeatTimer);
      const socket=this.socket;this.socket=null;if(socket)socket.close();this.onConnection(false);
    }
    connect(){
      if(!this.active||this.socket)return;
      const endpoint=new URL(this.url);endpoint.protocol=endpoint.protocol==='https:'?'wss:':'ws:';
      endpoint.pathname='/realtime/v1/websocket';endpoint.search='';
      endpoint.searchParams.set('apikey',this.key);endpoint.searchParams.set('vsn','1.0.0');
      let socket;try{socket=new WebSocket(endpoint.href);}catch(_){this.scheduleReconnect();return;}
      this.socket=socket;
      const send=(topic,event,payload,ref=String(++this.ref))=>{
        if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({topic,event,payload,ref,join_ref:topic===this.topic?this.joinRef:null}));
        return ref;
      };
      socket.onopen=()=>{
        if(this.socket!==socket)return;
        this.joinRef=String(++this.ref);
        send(this.topic,'phx_join',{config:{broadcast:{ack:false,self:false},presence:{enabled:false,key:''},postgres_changes:[],private:false}},this.joinRef);
        this.joinTimer=setTimeout(()=>socket.close(),10000);
      };
      socket.onmessage=event=>{
        if(this.socket!==socket)return;
        let message;try{message=JSON.parse(event.data);}catch(_){return;}
        if(message.event==='phx_reply'&&message.ref===this.joinRef){
          clearTimeout(this.joinTimer);
          if(message.payload?.status!=='ok'){socket.close();return;}
          this.retry=0;this.onConnection(true);this.onChange();
          this.heartbeatTimer=setInterval(()=>{
            if(this.pendingHeartbeat){socket.close();return;}
            this.pendingHeartbeat=send('phoenix','heartbeat',{});
          },25000);
        }else if(message.event==='phx_reply'&&message.ref===this.pendingHeartbeat){this.pendingHeartbeat=null;}
        else if(message.topic===this.topic&&message.event==='broadcast'&&message.payload?.event==='order-changed')this.onChange();
        else if(message.topic===this.topic&&['phx_error','phx_close'].includes(message.event))socket.close();
      };
      socket.onerror=()=>socket.close();
      socket.onclose=()=>{
        if(this.socket!==socket)return;
        this.socket=null;this.pendingHeartbeat=null;clearTimeout(this.joinTimer);clearInterval(this.heartbeatTimer);
        this.onConnection(false);this.scheduleReconnect();
      };
    }
    scheduleReconnect(){
      if(!this.active)return;
      clearTimeout(this.reconnectTimer);this.onConnection(false);
      this.reconnectTimer=setTimeout(()=>this.connect(),Math.min(30000,1000*2**Math.min(this.retry++,5)));
    }
  }
  root.GuestOrderLive=GuestOrderLive;
})(typeof window==='undefined'?globalThis:window);
