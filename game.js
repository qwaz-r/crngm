(() => {
  // ===== Telegram Mini App init =====
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  // ===== Canvas setup =====
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha: false });

  function resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);

  // ===== UI =====
  const elScore = document.getElementById("score");
  const elHp = document.getElementById("hp");
  const elMult = document.getElementById("mult");
  const elDmg = document.getElementById("dmg");
  const elGuns = document.getElementById("guns");

  const overlay = document.getElementById("overlay");
  const title = document.getElementById("title");
  const subtitle = document.getElementById("subtitle");
  const startBtn = document.getElementById("startBtn");
  const muteBtn = document.getElementById("muteBtn");

  let muted = false;
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    muteBtn.textContent = `ЗВУК: ${muted ? "OFF" : "ON"}`;
  });

  // ===== Helpers =====
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };

  // ===== Bullet tiers =====
  const BULLET_TIERS = [
    { name: "GRAY", hue: 0, sat: 0, light: 72, rateMul: 0.65, dmgAdd: 0, glowA: 0.10 },
    { name: "CYAN", hue: 190, sat: 88, light: 66, rateMul: 0.85, dmgAdd: 0, glowA: 0.14 },
    { name: "BLUE", hue: 215, sat: 96, light: 62, rateMul: 1.00, dmgAdd: 1, glowA: 0.18 },
    { name: "VIOLET", hue: 270, sat: 96, light: 64, rateMul: 1.10, dmgAdd: 2, glowA: 0.22 },
    { name: "RED", hue: 8, sat: 96, light: 62, rateMul: 1.18, dmgAdd: 3, glowA: 0.26 },
    { name: "GOLD", hue: 44, sat: 96, light: 62, rateMul: 1.25, dmgAdd: 4, glowA: 0.30 },
  ];

  function tierColor(tierIndex, alpha = 0.95) {
    const t = BULLET_TIERS[clamp(tierIndex, 0, BULLET_TIERS.length - 1)];
    return `hsla(${t.hue}, ${t.sat}%, ${t.light}%, ${alpha})`;
  }

  // ===== Game state =====
  const W = () => canvas.clientWidth;
  const H = () => canvas.clientHeight;

  let running = false;
  let last = 0;

  const world = {
    time: 0,
    score: 0,
    mult: 1,
    hp: 100,
    shake: 0,
    difficulty: 1,
  };

  // ===== Player =====
  const player = {
    x: 0, y: 0,
    vx: 0, vy: 0,
    r: 18,
    speed: 380,
    fireCooldown: 0,
    invuln: 0,

    tier: 0,
    guns: 1,          // до 9
    baseDmg: 1,
    baseFireRate: 6.0,
  };

  // ===== Entities =====
  const bullets = [];
  const enemyBullets = [];
  const enemies = [];
  const particles = [];
  const pickups = [];
  const allies = [];
  const skidMarks = [];

  // ===== Boss =====
  let bossTimer = 0;
  let bossAlive = false;

  function updateHud() {
    elScore.textContent = String(Math.floor(world.score));
    elHp.textContent = String(Math.max(0, Math.floor(world.hp)));
    elMult.textContent = String(world.mult);
    elDmg.textContent = String(player.baseDmg + BULLET_TIERS[player.tier].dmgAdd);
    elGuns.textContent = String(player.guns);
  }

  function resetGame() {
    world.time = 0;
    world.score = 0;
    world.mult = 1;
    world.hp = 100;
    world.shake = 0;
    world.difficulty = 1;

    player.x = W() / 2;
    player.y = H() * 0.78;
    player.vx = player.vy = 0;
    player.fireCooldown = 0;
    player.invuln = 0;

    player.tier = 0;
    player.guns = 1;
    player.baseDmg = 1;
    player.baseFireRate = 6.0;

    bullets.length = 0;
    enemyBullets.length = 0;
    enemies.length = 0;
    particles.length = 0;
    pickups.length = 0;
    allies.length = 0;
    skidMarks.length = 0;

    bossTimer = 0;
    bossAlive = false;

    updateHud();
  }

  // ===== Spawners =====
  let enemySpawnT = 0;

  function spawnEnemy() {
    const t = world.time;

    const truckChance = clamp(0.06 + (t / 240) * 0.20, 0.06, 0.26);
    const vanChance = clamp(0.18 + (t / 300) * 0.10, 0.18, 0.28);

    const r = Math.random();
    let kind = "car";
    if (r < truckChance) kind = "truck";
    else if (r < truckChance + vanChance) kind = "van";

    const roadW = Math.min(520, W() * 0.72);
    const roadX = (W() - roadW) / 2;

    const baseR = kind === "truck" ? rand(28, 36) : (kind === "van" ? rand(22, 26) : rand(18, 22));
    const hp = kind === "truck" ? 10 : (kind === "van" ? 5 : 2);

    enemies.push({
      kind,
      x: rand(roadX + 70, roadX + roadW - 70),
      y: -80,
      vx: rand(-22, 22),
      vy: rand(140, 240) + world.difficulty * 16,
      r: baseR,
      hp,
      shootT: rand(0.9, 2.2),
    });
  }

  function spawnBoss() {
    bossAlive = true;
    const roadW = Math.min(520, W() * 0.72);
    const roadX = (W() - roadW) / 2;

    enemies.push({
      kind: "boss",
      x: roadX + roadW / 2,
      y: 90,
      vx: 180,
      vy: 0,
      r: 44,
      hp: 120 + Math.floor(world.difficulty * 35),
      shootT: 0.25,
    });
  }

  function dropFromEnemy(e) {
    let dropChance = 0.22;
    if (e.kind === "van") dropChance = 0.30;
    if (e.kind === "truck") dropChance = 0.34;
    if (e.kind === "boss") dropChance = 1.00;

    if (Math.random() > dropChance) return;

    let kind = "mult";

    if (e.kind === "boss") {
      kind = "guns"; // с босса всегда GUNS+
    } else {
      const r = Math.random();
      if (r < 0.18) kind = "heal";
      else if (r < 0.34) kind = "mult";
      else if (r < 0.52) kind = "burst";
      else if (r < 0.78) kind = "tier";
      else kind = "ally";
    }

    pickups.push({
      x: e.x,
      y: e.y,
      vy: rand(40, 90),
      r: 14,
      kind,
      t: 0
    });
  }

  // ===== Allies =====
  function spawnAllies() {
    allies.length = 0;
    allies.push({ side: -1, alive: true, x: player.x - 36, y: player.y + 22, shootCd: 0 });
    allies.push({ side:  1, alive: true, x: player.x + 36, y: player.y + 22, shootCd: 0 });
  }

  // ===== FX =====
  function boom(x, y, base = 14) {
    for (let i = 0; i < 32; i++) {
      particles.push({
        x, y,
        vx: rand(-280, 280),
        vy: rand(-280, 280),
        life: rand(0.25, 0.75),
        t: 0,
        s: rand(1, 2.3) * base,
        kind: Math.random() < 0.55 ? "spark" : "smoke"
      });
    }
    world.shake = Math.min(14, world.shake + 8);
    if (!muted) navigator.vibrate?.(20);
  }

  function addScore(v) {
    world.score += v * world.mult;
  }

  function hurtPlayer(amount) {
    if (player.invuln > 0) return;
    world.hp -= amount;
    player.invuln = 0.9;
    world.mult = 1;
    boom(player.x, player.y, 10);
  }

  // ===== Drawing helpers =====
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawHeadlightCone(x, y, r, strength = 1) {
    // светит "вверх" (вперёд)
    const len = 180 + r * 2.6;
    const w0 = r * 0.35;
    const w1 = r * 2.4;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    const g = ctx.createLinearGradient(x, y - r, x, y - len);
    g.addColorStop(0, `rgba(230,255,255,${0.10 * strength})`);
    g.addColorStop(0.35, `rgba(0,210,255,${0.06 * strength})`);
    g.addColorStop(1, "rgba(0,0,0,0)");

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w0, y - r * 1.05);
    ctx.lineTo(x - w1, y - len);
    ctx.lineTo(x + w1, y - len);
    ctx.lineTo(x + w0, y - r * 1.05);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawBrakeGlow(x, y, r, on) {
    if (!on) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.65;

    // два красных пятна сзади (вниз)
    const gx = ctx.createRadialGradient(x - r * 0.45, y + r * 1.05, 2, x - r * 0.45, y + r * 1.05, r * 1.1);
    gx.addColorStop(0, "rgba(255,40,60,0.35)");
    gx.addColorStop(1, "rgba(255,40,60,0)");
    ctx.fillStyle = gx;
    ctx.beginPath();
    ctx.arc(x - r * 0.45, y + r * 1.05, r * 1.05, 0, Math.PI * 2);
    ctx.fill();

    const gx2 = ctx.createRadialGradient(x + r * 0.45, y + r * 1.05, 2, x + r * 0.45, y + r * 1.05, r * 1.1);
    gx2.addColorStop(0, "rgba(255,40,60,0.35)");
    gx2.addColorStop(1, "rgba(255,40,60,0)");
    ctx.fillStyle = gx2;
    ctx.beginPath();
    ctx.arc(x + r * 0.45, y + r * 1.05, r * 1.05, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawCarBody(x, y, r, colorA, colorB, neon, damaged = 0) {
    ctx.save();
    ctx.translate(x, y);

    // soft shadow
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(0, 10, r * 1.05, r * 1.35, 0, 0, Math.PI * 2);
    ctx.fill();


    // body
    ctx.globalAlpha = 1;
    const g = ctx.createLinearGradient(0, -r * 1.2, 0, r * 1.2);
    g.addColorStop(0, colorA);
    g.addColorStop(1, colorB);
    ctx.fillStyle = g;
    roundRect(ctx, -r * 0.92, -r * 1.28, r * 1.84, r * 2.56, 10);
    ctx.fill();

    // panel line
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.62, -r * 0.32);
    ctx.lineTo(r * 0.62, -r * 0.32);
    ctx.stroke();

    // glass
    const glass = ctx.createLinearGradient(-r, -r, r, r);
    glass.addColorStop(0, "rgba(220,240,255,0.18)");
    glass.addColorStop(1, "rgba(20,40,60,0.25)");
    ctx.fillStyle = glass;
    roundRect(ctx, -r * 0.58, -r * 0.68, r * 1.16, r * 1.24, 9);
    ctx.fill();

    // wet shimmer
    const shimmer = 0.5 + 0.5 * Math.sin(world.time * 2.2 + x * 0.01);
    ctx.globalAlpha = 0.08 + shimmer * 0.10;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    roundRect(ctx, -r * 0.78, -r * 1.08, r * 1.56, r * 0.58, 10);
    ctx.fill();
    ctx.globalAlpha = 1;

    // headlights (small)
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = neon;
    ctx.beginPath(); ctx.ellipse(-r * 0.50, -r * 1.08, r * 0.19, r * 0.23, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse( r * 0.50, -r * 1.08, r * 0.19, r * 0.23, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // damage soot
    if (damaged > 0) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "rgba(10,10,10,0.9)";
      for (let i = 0; i < damaged; i++) {
        ctx.beginPath();
        ctx.arc(rand(-r * 0.65, r * 0.65), rand(-r * 0.75, r * 0.75), rand(2, 6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function drawBackground() {
    const w = W(), h = H();

    ctx.fillStyle = "#070A10";
    ctx.fillRect(0, 0, w, h);

    // fog vignette
    const fog = ctx.createRadialGradient(w * 0.5, h * 0.6, 40, w * 0.5, h * 0.6, Math.max(w, h) * 0.7);
    fog.addColorStop(0, "rgba(0,255,200,0.06)");
    fog.addColorStop(0.4, "rgba(70,110,255,0.04)");
    fog.addColorStop(1, "rgba(0,0,0,0.88)");
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, w, h);

    const roadW = Math.min(520, w * 0.72);
    const roadX = (w - roadW) / 2;

    // road
    ctx.fillStyle = "rgba(10,14,22,0.92)";
    ctx.fillRect(roadX, 0, roadW, h);

    // neon rails
    ctx.fillStyle = "rgba(0,170,255,0.18)";
    ctx.fillRect(roadX - 3, 0, 2, h);
    ctx.fillRect(roadX + roadW + 1, 0, 2, h);

    // lane lines
    const lineW = 4, dashH = 34, gap = 22;
    const speed = 480 + world.difficulty * 34;
    const offset = (world.time * speed) % (dashH + gap);

    ctx.globalAlpha = 0.92;
    for (let i = 0; i < 3; i++) {
      const x = roadX + roadW * ((i + 1) / 4) - lineW / 2;
      for (let y = -dashH; y < h + dashH; y += dashH + gap) {
        const yy = y + offset;
        ctx.fillStyle = "rgba(255,120,40,0.52)";
        ctx.fillRect(x, yy, lineW, dashH);
      }
    }
    ctx.globalAlpha = 1;

    // puddles
    ctx.globalAlpha = 0.14;
    for (let i = 0; i < 7; i++) {
      const px = roadX + rand(40, roadW - 40);
      const py = rand(0, h);
      ctx.fillStyle = "rgba(0,210,255,0.35)";
      ctx.beginPath();
      ctx.ellipse(px, py, rand(20, 70), rand(6, 16), rand(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // rain
    ctx.globalAlpha = 0.10;
    ctx.strokeStyle = "rgba(200,220,255,0.9)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 120; i++) {
      const x = rand(0, w);
      const y = rand(0, h);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 2, y + 10);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // skid marks
    for (const m of skidMarks) {
      const a = clamp(m.life / m.maxLife, 0, 1) * 0.22;
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(0,0,0,0.9)";
      ctx.fillRect(m.x - m.w, m.y, 3, 18);
      ctx.fillRect(m.x + m.w, m.y, 3, 18);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    const sx = (Math.random() - 0.5) * world.shake;
    const sy = (Math.random() - 0.5) * world.shake;
    world.shake = Math.max(0, world.shake - 0.9);

    ctx.save();
    ctx.translate(sx, sy);

    drawBackground();

    // pickups
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const p of pickups) {
      const glow = 0.35 + 0.25 * Math.sin(p.t * 10);

      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.arc(p.x, p.y + 6, p.r * 1.1, 0, Math.PI * 2);
      ctx.fill();

      let col = "rgba(0,255,200,0.9)";
      if (p.kind === "heal") col = "rgba(0,255,160,0.95)";
      if (p.kind === "mult") col = "rgba(160,90,255,0.95)";
      if (p.kind === "burst") col = "rgba(255,120,40,0.95)";
      if (p.kind === "tier") col = "rgba(255,255,255,0.95)";
      if (p.kind === "guns") col = "rgba(255,210,60,0.95)";
      if (p.kind === "ally") col = "rgba(0,210,255,0.95)";

      const label =
        p.kind === "heal" ? "+" :
        p.kind === "mult" ? "x" :
        p.kind === "burst" ? "B" :
        p.kind === "tier" ? "UP" :
        p.kind === "guns" ? "G+" : "M";

      ctx.globalAlpha = glow;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 1.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.9, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(230,240,255,0.9)";
      ctx.font = "800 12px system-ui";
      ctx.fillText(label, p.x, p.y + 0.5);
    }

    // bullets (player)
    for (const b of bullets) {
      const bw = b.bw ?? 4;
      const bh = b.bh ?? 14;

      ctx.globalAlpha = 0.95;
      ctx.fillStyle = b.col;
      roundRect(ctx, b.x - bw / 2, b.y - bh, bw, bh, 3);
      ctx.fill();

      ctx.globalAlpha = 0.22;
      ctx.fillStyle = b.glow ?? b.col;
      ctx.fillRect(b.x - 1, b.y - bh - 16, 2, 16);
      ctx.globalAlpha = 1;
    }

    // enemy bullets
    for (const b of enemyBullets) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "rgba(0,255,140,0.85)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.20;
      ctx.fillStyle = "rgba(0,255,140,0.45)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // enemies
    for (const e of enemies) {
      if (e.kind === "boss") {
        drawCarBody(e.x, e.y, e.r, "#2B2F3A", "#121825", "rgba(255,210,60,0.85)", e.hp < 60 ? 6 : 2);
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        roundRect(ctx, -e.r * 0.5, -e.r * 0.25, e.r, e.r * 0.4, 8);
        ctx.fill();
        ctx.restore();
        // фары босса (чуть сильнее)
        drawHeadlightCone(e.x, e.y, e.r, 1.15);
        continue;
      }

      const damaged = e.hp <= 2 ? 6 : (e.hp <= 5 ? 3 : 0);

      if (e.kind === "car") {
        drawCarBody(e.x, e.y, e.r, "#1A1E2A", "#0E1320", "rgba(255,60,110,0.85)", damaged);
      } else if (e.kind === "van") {
        drawCarBody(e.x, e.y, e.r, "#22252E", "#11151F", "rgba(120,255,120,0.80)", damaged + 2);
      } else {
        drawCarBody(e.x, e.y, e.r, "#2A2D38", "#11151F", "rgba(0,255,140,0.80)", damaged + 2);
      }

      // фары врагов слабее
      drawHeadlightCone(e.x, e.y, e.r, 0.55);
    }

    // allies (moto)
    for (const a of allies) {
      if (!a.alive) continue;
      ctx.save();
      ctx.translate(a.x, a.y);

      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "rgba(0,210,255,0.9)";
      ctx.beginPath();
      ctx.ellipse(0, 10, 12, 18, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(10,14,22,0.9)";
      roundRect(ctx, -8, -14, 16, 28, 8);
      ctx.fill();

      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "rgba(0,210,255,0.85)";
      ctx.beginPath(); ctx.ellipse(0, -14, 3, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      ctx.restore();
    }

    // player headlights + brake lights
    const braking = joy.dy > 0.25; // джой вниз => стопы
    drawHeadlightCone(player.x, player.y, player.r, 1.0);
    drawBrakeGlow(player.x, player.y, player.r, braking);

    // player
    const inv = player.invuln > 0 ? 0.55 + 0.35 * Math.sin(world.time * 22) : 1;
    ctx.globalAlpha = inv;
    drawCarBody(player.x, player.y, player.r, "#1A2B3A", "#0B121C", "rgba(0,210,255,0.95)", 0);


    // particles
    for (const p of particles) {
      const a = 1 - (p.t / p.life);
      ctx.globalAlpha = a;
      if (p.kind === "spark") {
        ctx.fillStyle = "rgba(255,160,60,0.9)";
        ctx.fillRect(p.x, p.y, 2, 2);
      } else {
        ctx.fillStyle = "rgba(90,110,140,0.35)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.s * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // ===== Input (ONLY joystick) =====
  const joy = { active: false, id: null, cx: 0, cy: 0, dx: 0, dy: 0, max: 54 };
  const joyEl = document.getElementById("joy");
  const knobEl = document.getElementById("joyKnob");

  // Force joystick center-bottom layout (works even without CSS edits)
  function layoutJoystick() {
    if (!joyEl || !knobEl) return;
    joyEl.style.position = "fixed";
    joyEl.style.left = "50%";
    joyEl.style.bottom = "18px";
    joyEl.style.transform = "translateX(-50%)";
    joyEl.style.zIndex = "9999";
  }

  function setKnob(dx, dy) {
    knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  function joyStart(ev) {
    const t = (ev.changedTouches ? ev.changedTouches[0] : ev);
    joy.active = true;
    joy.id = t.identifier ?? "mouse";
    const r = joyEl.getBoundingClientRect();
    joy.cx = r.left + r.width / 2;
    joy.cy = r.top + r.height / 2;
    joyMove(ev);
  }

  function joyMove(ev) {
    if (!joy.active) return;
    const touches = ev.changedTouches ? Array.from(ev.changedTouches) : [ev];
    const t = touches.find(x => (x.identifier ?? "mouse") === joy.id);
    if (!t) return;

    const x = t.clientX, y = t.clientY;
    let dx = x - joy.cx;
    let dy = y - joy.cy;
    const len = Math.hypot(dx, dy) || 1;
    const m = Math.min(joy.max, len);
    dx = (dx / len) * m;
    dy = (dy / len) * m;

    joy.dx = dx / joy.max;
    joy.dy = dy / joy.max;
    setKnob(dx, dy);
    ev.preventDefault?.();
  }

  function joyEnd(ev) {
    if (!joy.active) return;
    const touches = ev.changedTouches ? Array.from(ev.changedTouches) : [ev];
    const t = touches.find(x => (x.identifier ?? "mouse") === joy.id);
    if (!t && ev.changedTouches) return;

    joy.active = false;
    joy.id = null;
    joy.dx = joy.dy = 0;
    setKnob(0, 0);
    ev.preventDefault?.();
  }

  joyEl.addEventListener("touchstart", joyStart, { passive: false });
  joyEl.addEventListener("touchmove", joyMove, { passive: false });
  joyEl.addEventListener("touchend", joyEnd, { passive: false });
  joyEl.addEventListener("touchcancel", joyEnd, { passive: false });

  joyEl.addEventListener("mousedown", joyStart);
  window.addEventListener("mousemove", joyMove);
  window.addEventListener("mouseup", joyEnd);

  // ===== Mechanics =====
  function shootAuto(dt) {
    player.fireCooldown -= dt;
    if (player.fireCooldown > 0) return;

    const tier = BULLET_TIERS[player.tier];
    const fireRate = player.baseFireRate * tier.rateMul;
    player.fireCooldown = 1 / fireRate;

    const dmg = player.baseDmg + tier.dmgAdd;
    const count = clamp(player.guns, 1, 9);

    const spread = 8 + count * 2;
    const offsets = [];
    for (let i = 0; i < count; i++) {
      const t = (count === 1) ? 0 : (i / (count - 1) * 2 - 1);
      offsets.push(t * spread);
    }

    const col = tierColor(player.tier, 0.95);
    const glow = tierColor(player.tier, tier.glowA);
    const bw = 3 + Math.floor(dmg / 2);
    const bh = 12 + dmg * 1.6;

    for (const dx of offsets) {
      bullets.push({
        x: player.x + dx,
        y: player.y - player.r - 2,
        vy: -860,
        r: 4,
        col,
        glow,
        bw,
        bh,
        dmg
      });
    }
  }

  function applyPickup(kind) {
    if (kind === "heal") {
      world.hp = Math.min(100, world.hp + 25);
      addScore(20);
    } else if (kind === "mult") {
      world.mult = Math.min(9, world.mult + 1);
      addScore(30);
    } else if (kind === "burst") {
      const col = tierColor(player.tier, 0.9);
      const glow = tierColor(player.tier, 0.18);
      for (let i = -2; i <= 2; i++) {
        bullets.push({
          x: player.x + i * 7,
          y: player.y - player.r - 2,
          vy: -820,
          r: 4,
          col,
          glow,
          bw: 4,
          bh: 18,
          dmg: 1
        });
      }
      addScore(25);
    } else if (kind === "tier") {
      player.tier = Math.min(BULLET_TIERS.length - 1, player.tier + 1);
      addScore(60);
      world.shake = Math.min(10, world.shake + 3);
    } else if (kind === "guns") {
      player.guns = Math.min(9, player.guns + 2);
      addScore(120);
      world.shake = Math.min(10, world.shake + 4);
    } else if (kind === "ally") {
      spawnAllies();
      addScore(40);
      world.shake = Math.min(10, world.shake + 2);
    }
  }

  function step(dt) {
    world.time += dt;
    world.difficulty = 1 + world.time / 25;

    // boss each minute
    bossTimer += dt;
    if (!bossAlive && bossTimer >= 60) {
      bossTimer = 0;
      spawnBoss();
    }

    // move player
    player.vx = joy.dx * player.speed;
    player.vy = joy.dy * player.speed;
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    const roadW = Math.min(520, W() * 0.72);
    const roadX = (W() - roadW) / 2;
    player.x = clamp(player.x, roadX + 26, roadX + roadW - 26);
    player.y = clamp(player.y, 60, H() - 60);

    player.invuln = Math.max(0, player.invuln - dt);

    // skid marks
    const speedNow = Math.hypot(player.vx, player.vy);
    if (speedNow > 240 && Math.random() < 0.35) {
      skidMarks.push({ x: player.x, y: player.y + 14, life: 2.2, maxLife: 2.2, w: 10 + Math.random() * 8 });
    }
    for (let i = skidMarks.length - 1; i >= 0; i--) {
      skidMarks[i].life -= dt;
      skidMarks[i].y += (240 + world.difficulty * 22) * dt;
      if (skidMarks[i].life <= 0 || skidMarks[i].y > H() + 60) skidMarks.splice(i, 1);
    }

    // auto shooting always
    shootAuto(dt);

    // progressive dense traffic
    enemySpawnT -= dt;
    const base = 0.75;
    const minI = 0.18;
    const interval = clamp(base - world.difficulty * 0.05, minI, base);

    if (enemySpawnT <= 0) {
      enemySpawnT = interval;

      const pack = 1 + Math.floor(clamp(world.time / 35, 0, 3)); // 1..4
      for (let i = 0; i < pack; i++) spawnEnemy();

      if (world.time > 60 && Math.random() < 0.25) spawnEnemy();
    }

    // bullets update
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.y += b.vy * dt;
      if (b.y < -60) bullets.splice(i, 1);
    }

    // enemy bullets update + hit player
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      const rr = (b.r + player.r) * (b.r + player.r);
      if (dist2(b.x, b.y, player.x, player.y) < rr) {
        enemyBullets.splice(i, 1);
        hurtPlayer(b.dmg);
        continue;
      }

      if (b.x < -80 || b.x > W() + 80 || b.y < -120 || b.y > H() + 120) enemyBullets.splice(i, 1);
    }

    // allies follow + shoot (auto with player)
    for (const a of allies) {
      if (!a.alive) continue;

      const targetX = player.x + a.side * 36;
      const targetY = player.y + 22;
      a.x += (targetX - a.x) * dt * 10;
      a.y += (targetY - a.y) * dt * 10;

      a.shootCd -= dt;
      if (a.shootCd <= 0) {
        a.shootCd = 0.18;
        const col = tierColor(player.tier, 0.85);
        bullets.push({
          x: a.x, y: a.y - 10,
          vy: -900,
          r: 4,
          col,
          glow: tierColor(player.tier, 0.16),
          bw: 3,
          bh: 12,
          dmg: 1
        });
      }
    }

    // enemies update + collisions
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];

      if (e.kind === "boss") {
        e.x += e.vx * dt;
        if (e.x < roadX + 90) { e.x = roadX + 90; e.vx *= -1; }
        if (e.x > roadX + roadW - 90) { e.x = roadX + roadW - 90; e.vx *= -1; }

        // boss shoots toward player
        e.shootT -= dt;
        if (e.shootT <= 0) {
          e.shootT = 0.22;

          const dx = player.x - e.x;
          const dy = player.y - e.y;
          const len = Math.hypot(dx, dy) || 1;
          const vx = (dx / len) * 260;
          const vy = (dy / len) * 260;

          const spread = 0.12 + clamp(world.difficulty * 0.01, 0, 0.18);
          for (const s of [-spread, 0, spread]) {
            const svx = vx * Math.cos(s) - vy * Math.sin(s);
            const svy = vx * Math.sin(s) + vy * Math.cos(s);
            enemyBullets.push({ x: e.x, y: e.y + e.r * 0.6, vx: svx, vy: svy, r: 4, dmg: 8 });
          }
        }

      } else {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.x = clamp(e.x, roadX + 30, roadX + roadW - 30);

        if (e.y > H() + 100) enemies.splice(i, 1);
      }

      // enemy hits player
      const rrP = (e.r + player.r) * (e.r + player.r);
      if (dist2(e.x, e.y, player.x, player.y) < rrP) {
        enemies.splice(i, 1);
        if (e.kind === "boss") { bossAlive = false; hurtPlayer(30); }
        else hurtPlayer(e.kind === "truck" ? 18 : 14);
        continue;
      }
    }

    // allies collide with enemies => ally disappears one by one
    for (const e of enemies) {
      if (e.kind === "boss") continue;
      for (const a of allies) {
        if (!a.alive) continue;
        const rr = (e.r + 12) * (e.r + 12);
        if (dist2(e.x, e.y, a.x, a.y) < rr) {
          a.alive = false;
          boom(a.x, a.y, 10);
          e.hp -= 1;
          break;
        }
      }
    }

    // pickups update
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.t += dt;
      p.y += p.vy * dt;

      const rr = (p.r + player.r) * (p.r + player.r);
      if (dist2(p.x, p.y, player.x, player.y) < rr) {
        applyPickup(p.kind);
        pickups.splice(i, 1);
        continue;
      }

      if (p.y > H() + 60) pickups.splice(i, 1);
    }

    // bullet hits
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const b = bullets[bi];
      let hit = false;

      for (let ei = enemies.length - 1; ei >= 0; ei--) {
        const e = enemies[ei];
        const rr = (e.r + b.r) * (e.r + b.r);

        if (dist2(e.x, e.y, b.x, b.y) < rr) {
          e.hp -= b.dmg;
          hit = true;

          particles.push({
            x: b.x, y: b.y,
            vx: rand(-160, 160), vy: rand(-160, 160),
            life: 0.18, t: 0, s: 8, kind: "spark"
          });

          if (e.hp <= 0) {
            boom(e.x, e.y, e.kind === "boss" ? 22 : 14);

            const score =
              e.kind === "boss" ? 600 :
              e.kind === "truck" ? 35 :
              e.kind === "van" ? 18 : 10;

            addScore(score);
            world.mult = Math.min(9, world.mult + 1);

            dropFromEnemy(e);

            if (e.kind === "boss") bossAlive = false;

            enemies.splice(ei, 1);
          } else {
            addScore(2);
          }
          break;
        }
      }

      if (hit) bullets.splice(bi, 1);
    }

    // particles update
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= (1 - dt * 2.5);
      p.vy *= (1 - dt * 2.5);
      if (p.t >= p.life) particles.splice(i, 1);
    }

    // passive score
    world.score += dt * 2.0 * world.mult;

    if (world.hp <= 0) gameOver();

    updateHud();
  }

  function gameOver() {
    running = false;
    overlay.classList.remove("hidden");
    title.textContent = "Game Over";
    subtitle.textContent = `Очки: ${Math.floor(world.score)}. Нажми СТАРТ чтобы заново.`;
    if (tg) tg.HapticFeedback?.notificationOccurred("error");
  }

  function loop(ts) {
    if (!running) return;
    const t = ts / 1000;
    const dt = clamp(t - last, 0, 0.033);
    last = t;
    step(dt);
    draw();
    requestAnimationFrame(loop);
  }

  startBtn.addEventListener("click", () => {
    overlay.classList.add("hidden");
    resetGame();
    running = true;
    last = performance.now() / 1000;
    if (tg) tg.HapticFeedback?.impactOccurred("medium");
    requestAnimationFrame(loop);
  });

  function boot() {
    resize();
    layoutJoystick();
    overlay.classList.remove("hidden");
    title.textContent = "Neon Car Shooter";
    subtitle.textContent = "Авто-стрельба. Джойстик снизу по центру. Фары/стопы работают.";
    resetGame();
    draw();
  }

  boot();
})();