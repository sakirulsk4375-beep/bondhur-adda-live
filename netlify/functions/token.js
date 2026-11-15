const { AccessToken } = require("livekit-server-sdk");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
  const { room, identity, name, canPublish } = JSON.parse(event.body || "{}");
  if (!room || !identity) return { statusCode: 400, body: "Missing room or identity" };
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity, name
  });
  at.addGrant({
    roomJoin: true, room,
    canPublish: !!canPublish, canSubscribe: true, canPublishData: true
  });
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: await at.toJwt() })
  };
};
