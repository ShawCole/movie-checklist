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

  const states = body.states;
  if (!states || typeof states !== "object") {
    return new Response(JSON.stringify({ error: "Missing states object" }), {
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

  const htmlRes = await fetch(`${siteUrl}/index.html`);
  let html = await htmlRes.text();

  // Inject saved states: replace the loadState function to use baked-in defaults
  const stateJson = JSON.stringify(states);
  const injection = `const SAVED_STATES = ${stateJson};\n`;

  if (html.includes("const SAVED_STATES =")) {
    // Replace existing injection
    html = html.replace(/const SAVED_STATES = .+;\n/, injection);
  } else {
    // Insert before MOVIES const
    html = html.replace("const MOVIES = [", injection + "const MOVIES = [");
  }

  // Compute SHA1 for deploy API
  const sha1 = createHash("sha1").update(html).digest("hex");

  // Step 1: Create deploy with file manifest
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

  // Step 2: Upload the file
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
    JSON.stringify({ success: true, deploy_id: deployId, url: siteUrl }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
