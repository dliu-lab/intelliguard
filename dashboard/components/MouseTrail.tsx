"use client";

import { useEffect, useRef } from "react";

type TrailVariant = "default" | "landing";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  decay: number;
  color: string;
  twinkle: boolean;
  twinkleSpeed: number;
  twinklePhase: number;
  rotation: number;
  rotationSpeed: number;
};

type Point = {
  x: number;
  y: number;
};

const DEFAULT_COLORS = ["#ffffff", "#f0fff4", "#6ee7b7", "#34d399", "#10b981", "#a7f3d0", "#d1fae5"];

const LANDING_COLORS = ["#ffffff", "#d8fff5", "#86ffe3", "#00c896", "#4de7c2", "#9be7ff", "#e6edf3"];

const LERP = 0.12;

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function createParticle(x: number, y: number, variant: TrailVariant): Particle {
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

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, rotation: number) {
  const spikes = 4;
  const innerRadius = radius * 0.45;

  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i += 1) {
    const activeRadius = i % 2 === 0 ? radius : innerRadius;
    const angle = (i * Math.PI) / spikes + rotation;
    const nextX = x + Math.cos(angle) * activeRadius;
    const nextY = y + Math.sin(angle) * activeRadius;

    if (i === 0) {
      ctx.moveTo(nextX, nextY);
    } else {
      ctx.lineTo(nextX, nextY);
    }
  }
  ctx.closePath();
  ctx.fill();
}

function drawOrb(ctx: CanvasRenderingContext2D, x: number, y: number, variant: TrailVariant) {
  const landing = variant === "landing";
  const glowRadius = landing ? 34 : 22;
  const coreRadius = landing ? 9 : 7;

  const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
  glow.addColorStop(0, landing ? "rgba(0, 200, 150, 0.48)" : "rgba(110, 231, 183, 0.35)");
  glow.addColorStop(0.46, landing ? "rgba(155, 231, 255, 0.18)" : "rgba(110, 231, 183, 0.12)");
  glow.addColorStop(1, "rgba(0, 200, 150, 0)");

  ctx.globalAlpha = 1;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  const core = ctx.createRadialGradient(x, y, 0, x, y, coreRadius);
  core.addColorStop(0, "#ffffff");
  core.addColorStop(0.38, landing ? "#86ffe3" : "#a7f3d0");
  core.addColorStop(1, landing ? "rgba(0, 200, 150, 0)" : "rgba(52, 211, 153, 0)");

  ctx.shadowBlur = landing ? 22 : 14;
  ctx.shadowColor = landing ? "#00c896" : "#6ee7b7";
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, coreRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

export function MouseTrail({ variant = "landing" }: { variant?: TrailVariant }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particles = useRef<Particle[]>([]);
  const mouse = useRef<Point>({ x: -200, y: -200 });
  const wand = useRef<Point>({ x: -200, y: -200 });
  const rafId = useRef<number | null>(null);
  const lastEmit = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!canvas || !ctx || reduceMotion) {
      return undefined;
    }

    const activeCanvas = canvas;
    const activeCtx = ctx;

    function resize() {
      const ratio = window.devicePixelRatio || 1;
      activeCanvas.width = Math.floor(window.innerWidth * ratio);
      activeCanvas.height = Math.floor(window.innerHeight * ratio);
      activeCanvas.style.width = `${window.innerWidth}px`;
      activeCanvas.style.height = `${window.innerHeight}px`;
      activeCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function onMove(event: PointerEvent) {
      if (event.pointerType === "touch") {
        return;
      }

      mouse.current = { x: event.clientX, y: event.clientY };
      const now = performance.now();
      if (now - lastEmit.current > (variant === "landing" ? 12 : 16)) {
        const count = Math.floor(randomBetween(variant === "landing" ? 4 : 3, variant === "landing" ? 8 : 6));
        for (let i = 0; i < count; i += 1) {
          particles.current.push(createParticle(event.clientX, event.clientY, variant));
        }
        lastEmit.current = now;
      }
    }

    function loop() {
      activeCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      wand.current.x += (mouse.current.x - wand.current.x) * LERP;
      wand.current.y += (mouse.current.y - wand.current.y) * LERP;

      particles.current = particles.current.filter((particle) => particle.alpha > 0.01);
      const time = performance.now() * 0.001;

      for (const particle of particles.current) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.04;
        particle.alpha -= particle.decay;
        particle.rotation += particle.rotationSpeed;

        const displayAlpha = particle.twinkle
          ? particle.alpha * (0.6 + 0.4 * Math.sin(time * particle.twinkleSpeed * 60 + particle.twinklePhase))
          : particle.alpha;

        activeCtx.globalAlpha = Math.max(0, displayAlpha);
        activeCtx.fillStyle = particle.color;
        activeCtx.shadowBlur = variant === "landing" ? 12 : 8;
        activeCtx.shadowColor = particle.color;
        drawStar(activeCtx, particle.x, particle.y, particle.radius, particle.rotation);
      }

      activeCtx.globalAlpha = 1;
      activeCtx.shadowBlur = 0;
      drawOrb(activeCtx, wand.current.x, wand.current.y, variant);

      rafId.current = requestAnimationFrame(loop);
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove);
    document.documentElement.classList.add("has-mouse-trail");
    rafId.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
      document.documentElement.classList.remove("has-mouse-trail");
    };
  }, [variant]);

  return <canvas ref={canvasRef} aria-hidden="true" className="mouse-trail-canvas" />;
}
