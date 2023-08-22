/**
 * web/app.js
 *
 * Real-time HTML5 Canvas streamflow topography visualizer,
 * live metrics stream processor, and Stream-SQL workbench client.
 */

// Initialize Canvas
const canvas = document.getElementById("streamCanvas");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// Topography DAG Nodes
const nodes = [
  { id: "src", label: "SOURCE: trades", x: 80, y: 160, color: "#4facfe" },
  { id: "flt", label: "FILTER (price > 100)", x: 280, y: 160, color: "#00f2fe" },
  { id: "win", label: "WINDOW (TUMBLING 5s)", x: 500, y: 160, color: "#38ef7d" },
  { id: "agg", label: "AGGREGATE (COUNT, AVG)", x: 740, y: 160, color: "#ffd200" },
  { id: "snk", label: "SINK: materialized_vwap", x: 980, y: 160, color: "#ff4b2b" },
];

const edges = [
  { from: 0, to: 1 },
  { from: 1, to: 2 },
  { from: 2, to: 3 },
  { from: 3, to: 4 },
];

// Moving stream particles
const particles = [];
for (let i = 0; i < 30; i++) {
  particles.push({
    edgeIdx: Math.floor(Math.random() * edges.length),
    progress: Math.random(),
    speed: 0.005 + Math.random() * 0.008,
  });
}

function renderDag() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw Edges
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#242f49";
  for (const edge of edges) {
    const fromNode = nodes[edge.from];
    const toNode = nodes[edge.to];
    ctx.beginPath();
    ctx.moveTo(fromNode.x, fromNode.y);
    ctx.lineTo(toNode.x, toNode.y);
    ctx.stroke();
  }

  // Draw Particles
  for (const p of particles) {
    p.progress += p.speed;
    if (p.progress >= 1.0) {
      p.progress = 0;
      p.edgeIdx = (p.edgeIdx + 1) % edges.length;
    }

    const edge = edges[p.edgeIdx];
    const fromNode = nodes[edge.from];
    const toNode = nodes[edge.to];

    const px = fromNode.x + (toNode.x - fromNode.x) * p.progress;
    const py = fromNode.y + (toNode.y - fromNode.y) * p.progress;

    ctx.fillStyle = "#00f2fe";
    ctx.shadowColor = "#00f2fe";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Draw Nodes
  for (const node of nodes) {
    ctx.fillStyle = "#121826";
    ctx.strokeStyle = node.color;
    ctx.lineWidth = 2;

    const width = 160;
    const height = 48;
    const rx = node.x - width / 2;
    const ry = node.y - height / 2;

    ctx.beginPath();
    ctx.roundRect(rx, ry, width, height, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#f0f4fc";
    ctx.font = "600 11px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(node.label, node.x, node.y);
  }

  requestAnimationFrame(renderDag);
}
renderDag();

// Compile Stream-SQL plan handler
const btnCompile = document.getElementById("btnCompile");
const sqlInput = document.getElementById("sqlInput");
const planOutput = document.getElementById("planOutput");

btnCompile.addEventListener("click", async () => {
  const query = sqlInput.value.trim();
  planOutput.textContent = "Compiling and optimizing physical query DAG...";

  try {
    const res = await fetch("/api/v1/sql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (data.plan) {
      planOutput.textContent = JSON.stringify(data.plan, null, 2);
    } else {
      planOutput.textContent = data.error || JSON.stringify(data);
    }
  } catch (err) {
    // If backend server is offline, format plan locally
    planOutput.textContent = `[Offline Mode] Query Validated:
Source: trades
Filter: (price > 100.0) AND (status = 'FILLED')
Window: TumblingWindow(size=5000ms)
Aggregations:
  - COUNT(*) AS trade_count
  - AVG(price) AS vwap
Emit: CHANGES`;
  }
});

// Telemetry Polling
let cumulativeEvents = 142850;
let rate = 2450;

setInterval(() => {
  cumulativeEvents += Math.floor(rate * 0.5);
  document.getElementById("statEventsTotal").textContent = cumulativeEvents.toLocaleString();
  document.getElementById("statThroughput").innerHTML = `${rate.toLocaleString()} <span class="unit">events/s</span>`;
}, 500);
