

// This script simulates GitHub sending a webhook payload to your local server.
// It uses a real repository/PR if you want the Octokit API to successfully fetch code.
// Replace these with a real owner/repo/PR you have access to, or test against a public one.

const payload = {
  action: "opened",
  pull_request: {
    number: 1, // Change to a real PR number in your repo
    base: {
      sha: "main",
      ref: "main"
    },
    head: {
      sha: "working-branch",
      ref: "working-branch"
    }
  },
  repository: {
    name: "cloudgauge-frontend", // Replace with real repo
    owner: {
      login: "MAINUDDIN" // Replace with your github username
    }
  }
};

console.log('Sending mock GitHub Webhook event to localhost...');

try {
  const response = await fetch('http://localhost:3001/webhook/github', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // 'x-hub-signature-256': '...' // GitHub sends this for security
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  console.log(`Response Status: ${response.status}`);
  console.log(`Response Body: ${text}`);

  if (response.status === 202) {
    console.log('\n✅ Webhook accepted! Check your server console to see the analysis logs.');
    console.log('If the analysis completes, a comment will be posted to the PR.');
  }

} catch (err) {
  console.error('Failed to send webhook. Is the server running (npm run dev)?');
  console.error(err);
}
