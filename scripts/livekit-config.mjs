export function livekitConfig(env=process.env) {
  if(env.REDIS_ENABLED && !['true','false'].includes(env.REDIS_ENABLED))throw Error('REDIS_ENABLED debe ser true o false');
  const key=env.LIVEKIT_API_KEY??'devkey';
  const config={
    port:7880,
    bind_addresses:['0.0.0.0'],
    rtc:{tcp_port:7881,udp_port:7882,use_external_ip:env.LIVEKIT_USE_EXTERNAL_IP==='true'},
    keys:{[key]:env.LIVEKIT_API_SECRET??'local-development-secret-change-me-32'},
    webhook:{api_key:key,urls:[env.LIVEKIT_WEBHOOK_URL??'http://127.0.0.1:3001/api/webhooks/livekit']}
  };
  if(env.TURN_HOST){
    const port=Number(env.TURN_PORT??443);
    const protocol=env.TURN_PROTOCOL??'tls';
    if(!Number.isInteger(port)||port<1||port>65535)throw Error('TURN_PORT inválido');
    if(!['tls','tcp','udp'].includes(protocol))throw Error('TURN_PROTOCOL debe ser tls, tcp o udp');
    if(!env.TURN_SHARED_SECRET&&(!env.TURN_USERNAME||!env.TURN_CREDENTIAL))throw Error('TURN requiere TURN_SHARED_SECRET o TURN_USERNAME y TURN_CREDENTIAL');
    config.rtc.turn_servers=[{host:env.TURN_HOST,port,protocol,...(env.TURN_SHARED_SECRET?{secret:env.TURN_SHARED_SECRET}:{username:env.TURN_USERNAME,credential:env.TURN_CREDENTIAL})}];
  }
  if(env.LIVEKIT_ADVERTISE_INTERNAL_IP==='true')config.rtc.advertise_internal_ip=true;
  if(env.REDIS_ENABLED==='true'){
    if(!env.REDIS_ADDRESS)throw Error('REDIS_ADDRESS requerido cuando REDIS_ENABLED=true');
    config.redis={address:env.REDIS_ADDRESS,...(env.REDIS_PASSWORD?{password:env.REDIS_PASSWORD}:{})};
  }
  return config;
}
