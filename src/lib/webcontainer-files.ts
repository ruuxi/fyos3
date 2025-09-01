import type { FileSystemTree } from '@webcontainer/api';

export const files: FileSystemTree = {
  'package.json': {
    file: {
      contents: `{
  "name": "webcontainer-demo",
  "type": "module",
  "scripts": {
    "start": "nodemon --watch './' index.js",
    "dev": "nodemon --watch './' index.js"
  },
  "dependencies": {
    "express": "latest",
    "nodemon": "latest"
  }
}`,
    },
  },
  'index.js': {
    file: {
      contents: `import express from 'express';

const app = express();
const port = 3111;

app.get('/', (req, res) => {
  res.send(\`
    <html>
      <head>
        <title>WebContainer Demo</title>
        <style>
          body { 
            font-family: system-ui, -apple-system, sans-serif; 
            margin: 0; 
            padding: 2rem;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .container {
            text-align: center;
            max-width: 600px;
          }
          h1 {
            font-size: 3rem;
            margin-bottom: 1rem;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
          }
          p {
            font-size: 1.2rem;
            opacity: 0.9;
            line-height: 1.6;
          }
          .badge {
            background: rgba(255,255,255,0.2);
            padding: 0.5rem 1rem;
            border-radius: 50px;
            display: inline-block;
            margin: 1rem 0;
            backdrop-filter: blur(10px);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🚀 WebContainer Demo</h1>
          <div class="badge">Running on Node.js in your browser!</div>
          <p>
            This Express.js server is running entirely in your browser using WebContainer technology.
            No backend server required - it's all client-side magic!
          </p>
          <p>
            <strong>Port:</strong> \${port} | 
            <strong>Time:</strong> \${new Date().toLocaleTimeString()}
          </p>
        </div>
      </body>
    </html>
  \`);
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    message: 'WebContainer is working!',
    timestamp: new Date().toISOString(),
    port: port
  });
});

app.listen(port, () => {
  console.log(\`🎉 WebContainer app running at http://localhost:\${port}\`);
});`,
    },
  },
  'README.md': {
    file: {
      contents: `# WebContainer Demo

This is a demo application running inside a WebContainer!

## Features

- Express.js server running in the browser
- No backend infrastructure needed
- Real-time development environment
- Full Node.js compatibility

## Getting Started

The application automatically starts when the WebContainer boots up.

Visit the root URL to see the demo page.
`,
    },
  },
};
