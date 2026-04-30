import React, { useEffect, useRef } from "react";

const DEFAULT_COLORS = [
  "#ffffff", // white
  "#f0fff4", // near-white green tint
  "#6ee7b7", // mint green
  "#34d399", // emerald
  "#10b981", // green
  "#a7f3d0", // pale green
  "#d1fae5", // very pale green
];

const LANDING_COLORS = [
  "#ffffff",
  "#d8fff5",
  "#86ffe3",
  "#00c896",
  "#4de7c2",
  "#9be7ff",
  "#e6edf3",
];

const LERP = 0.12; // how snappily the orb follows — lower = more lag

function randomBetween(a, b) {
  return a + Math.random() * (b - a);
}

function createParticle(x, y, variant) {
  const angle = randomBetween(0, Math.PI * 2);
  const landing = variant === "landing";
  const colors = landing ? LANDING_COLORS : DEFAULT_COLORS;
  const speed = randomBetween(landing ? 0.35 : 0.5, landing ? 2.2 : 2.8);

  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - randomBetween(0.5, 1.5),
    radius: randomBetween(landing ? 1.5 : 2, landing ? 4.2 : 5),
    alpha: 1,
    decay: randomBetween(landing ? 0.012 : 0.018, landing ? 0.028 : 0.038),
    color: colors[Math.floor(Math.random() * colors.length)],
    twinkle: Math.random() > 0.5,
    twinkleSpeed: randomBetween(0.08, 0.2),
    twinklePhase: randomBetween(0, Math.PI * 2),
    rotation: randomBetween(0, Math.PI * 2),
    rotationSpeed: randomBetween(-0.15, 0.15),
  };
}

function drawStar(ctx, x, y, r, rotation) {
  const spikes = 4;
  const inner = r * 0.45;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const rr = i % 2 === 0 ? r : inner;
    const angle = (i * Math.PI) / spikes + rotation;
    i === 0
      ? ctx.moveTo(x + Math.cos(angle) * rr, y + Math.sin(angle) * rr)
      : ctx.lineTo(x + Math.cos(angle) * rr, y + Math.sin(angle) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function drawOrb(ctx, x, y, variant) {
  const landing = variant === "landing";
  // outer soft glow
  const glow = ctx.createRadialGradient(x, y, 0, x, y, landing ? 34 : 22);
  glow.addColorStop(0, landing ? "rgba(0, 200, 150, 0.48)" : "rgba(110, 231, 183, 0.35)");
  glow.addColorStop(0.46, landing ? "rgba(155, 231, 255, 0.18)" : "rgba(110, 231, 183, 0.12)");
  glow.addColorStop(1, "rgba(0, 200, 150, 0)");
  ctx.globalAlpha = 1;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, landing ? 34 : 22, 0, Math.PI * 2);
  ctx.fill();

  // inner bright core
  const core = ctx.createRadialGradient(x, y, 0, x, y, landing ? 9 : 7);
  core.addColorStop(0, "#ffffff");
  core.addColorStop(0.38, landing ? "#86ffe3" : "#a7f3d0");
  core.addColorStop(1, landing ? "rgba(0, 200, 150, 0)" : "rgba(52, 211, 153, 0)");
  ctx.shadowBlur = landing ? 22 : 14;
  ctx.shadowColor = landing ? "#00c896" : "#6ee7b7";
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, landing ? 9 : 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

export default function MouseTrail({ variant = "default" }) {
  const canvasRef = useRef(null);
  const particles = useRef([]);
  const mouse = useRef({ x: -200, y: -200 });
  const wand = useRef({ x: -200, y: -200 }); // lerped orb position
  const rafId = useRef(null);
  const lastEmit = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    function onMove(event) {
      if (event.pointerType === "touch") {
        return;
      }

      mouse.current = { x: event.clientX, y: event.clientY };
      const now = performance.now();
      if (now - lastEmit.current > (variant === "landing" ? 12 : 16)) {
        const count = Math.floor(randomBetween(variant === "landing" ? 4 : 3, variant === "landing" ? 8 : 6));
        for (let i = 0; i < count; i++) {
          particles.current.push(createParticle(event.clientX, event.clientY, variant));
        }
        lastEmit.current = now;
      }
    }
    window.addEventListener("pointermove", onMove);

    // hide default cursor globally
    document.documentElement.style.cursor = "none";

    function loop() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // lerp orb toward real mouse
      wand.current.x += (mouse.current.x - wand.current.x) * LERP;
      wand.current.y += (mouse.current.y - wand.current.y) * LERP;

      // draw particles
      particles.current = particles.current.filter((p) => p.alpha > 0.01);
      const t = performance.now() * 0.001;
      for (const p of particles.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.04;
        p.alpha -= p.decay;
        p.rotation += p.rotationSpeed;

        const displayAlpha = p.twinkle
          ? p.alpha * (0.6 + 0.4 * Math.sin(t * p.twinkleSpeed * 60 + p.twinklePhase))
          : p.alpha;

        ctx.globalAlpha = Math.max(0, displayAlpha);
        ctx.fillStyle = p.color;
        ctx.shadowBlur = variant === "landing" ? 12 : 8;
        ctx.shadowColor = p.color;
        drawStar(ctx, p.x, p.y, p.radius, p.rotation);
      }

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // draw orb on top
      drawOrb(ctx, wand.current.x, wand.current.y, variant);

      rafId.current = requestAnimationFrame(loop);
    }
    loop();

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(rafId.current);
      document.documentElement.style.cursor = "";
    };
  }, [variant]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        pointerEvents: "none",
        zIndex: 9999,
      }}
    />
  );
}
