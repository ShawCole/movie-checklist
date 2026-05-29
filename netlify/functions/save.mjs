import { createHash } from "crypto";

const SITE_ID = "60ab71b3-1a10-4269-b380-922e5e2db125";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const token = process.env.NETLIFY_DEPLOY_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ error: "Deploy token not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { user, states } = body;
  if (!user || typeof user !== "string" || !states || typeof states !== "object") {
    return new Response(JSON.stringify({ error: "Missing user or states" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Fetch current deployed index.html
  const siteRes = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const siteData = await siteRes.json();
  const siteUrl = siteData.ssl_url || siteData.url;

  const htmlRes = await fetch(`${siteUrl}/index.html?_cb=${Date.now()}`);
  let html = await htmlRes.text();

  // Extract existing ALL_USERS from the HTML
  let allUsers = {};
  const match = html.match(/const ALL_USERS = (\{[\s\S]*?\});\s*\nconst STATES/);
  if (match) {
    try {
      allUsers = JSON.parse(match[1]);
    } catch (e) {
      // If parse fails, start fresh
      allUsers = {};
    }
  }

  // Merge this user's states in
  allUsers[user] = states;

  const allUsersJson = JSON.stringify(allUsers);
  const injection = `const ALL_USERS = ${allUsersJson};\nconst STATES`;

  if (match) {
    html = html.replace(/const ALL_USERS = \{[\s\S]*?\};\s*\nconst STATES/, injection);
  } else {
    html = html.replace("const ALL_USERS = {};\nconst STATES", injection);
  }

  // Compute SHA1 for deploy API
  const sha1 = createHash("sha1").update(html).digest("hex");

  // Create deploy with file manifest
  const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/deploys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      files: { "/index.html": sha1 },
    }),
  });

  if (!deployRes.ok) {
    const err = await deployRes.text();
    return new Response(JSON.stringify({ error: "Deploy create failed", detail: err }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const deployData = await deployRes.json();
  const deployId = deployData.id;

  // Upload the file
  const uploadRes = await fetch(
    `https://api.netlify.com/api/v1/deploys/${deployId}/files/%2Findex.html`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      body: html,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    return new Response(JSON.stringify({ error: "File upload failed", detail: err }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ success: true, deploy_id: deployId, users: Object.keys(allUsers) }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
