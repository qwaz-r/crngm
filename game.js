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
  const fireBtn = document.getElementById("fire");

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
    laneGlow: 0,
    difficulty: 1
  };

  // ===== Player =====
  const player = {
    x: 0, y: 0,
    vx: 0, vy: 0,
    r: 18,
    speed: 380,
    fireRate: 9,
    fireCooldown: 0,
    invuln: 0,
    dmg: 1,
    guns: 1,        // 1,2,3,5
    bulletHue: 195, // 210=синее, 0=красное
  };

  // ===== Entities =====
  const bullets = [];
  const enemies = [];
  const particles = [];
  const pickups = [];

  function updateHud() {
    elScore.textContent = String(Math.floor(world.score));
    elHp.textContent = String(Math.max(0, Math.floor(world.hp)));
    elMult.textContent = String(world.mult);
    elDmg.textContent = String(player.dmg);
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
    player.dmg = 1;
    player.guns = 1;
    player.bulletHue = 195;

    bullets.length = 0;
    enemies.length = 0;
    particles.length = 0;
    pickups.length = 0;

    updateHud();
  }

  // ===== Spawners =====
  let enemySpawnT = 0;
  let pickupSpawnT = 0;

  function spawnEnemy() {
    const roll = Math.random();

    let kind = "car";
    if (roll < 0.70) kind = "car";
    else if (roll < 0.88) kind = "van";
    else kind = "truck";

    const baseR = kind === "truck" ? rand(28, 36) : rand(16, 22);
    const hp = kind === "truck" ? 12 : (kind === "van" ? 5 : 2);

    enemies.push({
      x: rand(60, W() - 60),
      y: -60,
      vx: rand(-25, 25),
      vy: rand(120, 210) + world.difficulty * 18,
      r: baseR,
      hp,
      kind,
      shootT: rand(0.6, 1.4),
    });
  }

  function spawnPickup() {
    // heal, mult, burst, dmg, guns
    const r = Math.random();
    let kind = "heal";
    if (r < 0.30) kind = "heal";
    else if (r < 0.48) kind = "mult";
    else if (r < 0.62) kind = "burst";
    else if (r < 0.82) kind = "dmg";
    else kind = "guns";

    pickups.push({
      x: rand(50, W() - 50),
      y: -30,
      vy: rand(140, 200),
      r: 14,
      kind,
      t: 0
    });
  }

  // ===== FX =====
  function boom(x, y, base = 14) {
    for (let i = 0; i < 28; i++) {
      particles.push({
        x, y,
        vx: rand(-260, 260),
        vy: rand(-260, 260),
        life: rand(0.25, 0.7),
        t: 0,
        s: rand(1, 2.2) * base,
        kind: Math.random() < 0.5 ? "spark" : "smoke"
      });
    }
    world.shake = Math.min(14, world.shake + 8);
    if (!muted) navigator.vibrate?.(20);
  }

  // ===== Drawing =====
  function drawBackground(dt) {
    const w = W(), h = H();

    ctx.fillStyle = "#070A10";
    ctx.fillRect(0, 0, w, h);

    const fog = ctx.createRadialGradient(w * 0.5, h * 0.6, 40, w * 0.5, h * 0.6, Math.max(w, h) * 0.7);
    fog.addColorStop(0, "rgba(0,255,200,0.06)");
    fog.addColorStop(0.4, "rgba(70,110,255,0.04)");
    fog.addColorStop(1, "rgba(0,0,0,0.85)");
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, w, h);

    const roadW = Math.min(520, w * 0.72);
    const roadX = (w - roadW) / 2;
    ctx.fillStyle = "rgba(10,14,22,0.9)";
    ctx.fillRect(roadX, 0, roadW, h);

    // side rails
    ctx.fillStyle = "rgba(0,170,255,0.18)";
    ctx.fillRect(roadX - 3, 0, 2, h);
    ctx.fillRect(roadX + roadW + 1, 0, 2, h);

    // lane lines
    world.laneGlow = clamp(world.laneGlow + dt * 0.6, 0, 1);
    const lineW = 4;
    const dashH = 34;
    const gap = 22;
    const speed = 460 + world.difficulty * 30;
    const offset = (world.time * speed) % (dashH + gap);

    ctx.globalAlpha = 0.95;
    for (let i = 0; i < 3; i++) {
      const x = roadX + roadW * ((i + 1) / 4) - lineW / 2;
      for (let y = -dashH; y < h + dashH; y += dashH + gap) {
        const yy = y + offset;
        ctx.fillStyle = "rgba(255,120,40,0.55)";
        ctx.fillRect(x, yy, lineW, dashH);
      }
    }
    ctx.globalAlpha = 1;

    // puddles
    ctx.globalAlpha = 0.16;
    for (let i = 0; i < 8; i++) {
      const px = roadX + rand(40, roadW - 40);
      const py = rand(0, h);
      ctx.fillStyle = "rgba(0,210,255,0.35)";
      ctx.beginPath();
      ctx.ellipse(px, py, rand(20, 60), rand(6, 14), rand(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // rain
    ctx.globalAlpha = 0.12;
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
  }

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

  function drawCarBody(x, y, r, colorA, colorB, detailColor, damaged = 0) {
    ctx.save();
    ctx.translate(x, y);

    // shadow
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(0, 6, r * 0.95, r * 1.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // body
    const g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, colorA);
    g.addColorStop(1, colorB);
    ctx.fillStyle = g;
    roundRect(ctx, -r * 0.85, -r * 1.15, r * 1.7, r * 2.3, 8);
    ctx.fill();

    // roof
    ctx.fillStyle = "rgba(230,240,255,0.22)";
    roundRect(ctx, -r * 0.5, -r * 0.6, r, r * 1.1, 7);
    ctx.fill();

    // hood line
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, -r * 0.1);
    ctx.lineTo(r * 0.55, -r * 0.1);
    ctx.stroke();

    // headlights
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = detailColor;
    ctx.beginPath(); ctx.ellipse(-r * 0.45, -r * 1.0, r * 0.18, r * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse( r * 0.45, -r * 1.0, r * 0.18, r * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // damage
    if (damaged > 0) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "rgba(20,20,20,0.9)";
      for (let i = 0; i < damaged; i++) {
        ctx.beginPath();
        ctx.arc(rand(-r * 0.6, r * 0.6), rand(-r * 0.7, r * 0.7), rand(2, 5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function draw() {
    const sx = (Math.random() - 0.5) * world.shake;
    const sy = (Math.random() - 0.5) * world.shake;
    world.shake = Math.max(0, world.shake - 0.9);

    ctx.save();
    ctx.translate(sx, sy);

    drawBackground(0);

    // pickups
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const p of pickups) {
      const glow = 0.35 + 0.25 * Math.sin(p.t * 10);

      // shadow
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.arc(p.x, p.y + 6, p.r * 1.1, 0, Math.PI * 2);
      ctx.fill();

      // color + label
      let col = "rgba(0,255,200,0.9)";
      if (p.kind === "heal") col = "rgba(0,255,160,0.95)";
      if (p.kind === "mult") col = "rgba(160,90,255,0.95)";
      if (p.kind === "burst") col = "rgba(255,120,40,0.95)";
      if (p.kind === "dmg") col = "rgba(255,60,110,0.95)";
      if (p.kind === "guns") col = "rgba(0,210,255,0.95)";

      const label =
        p.kind === "heal" ? "+" :
        p.kind === "mult" ? "x" :
        p.kind === "burst" ? "B" :
        p.kind === "dmg" ? "DMG" : "G";

      // glow ring
      ctx.globalAlpha = glow;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 1.2, 0, Math.PI * 2);
      ctx.fill();

      // core
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.9, 0, Math.PI * 2);
      ctx.fill();

      // text
      ctx.fillStyle = "rgba(230,240,255,0.9)";
      ctx.font = "800 12px system-ui";
      ctx.fillText(label, p.x, p.y + 0.5);
    }

    // bullets
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

    // enemies
    for (const e of enemies) {
      const damaged = e.hp <= 3 ? 6 : (e.hp <= 7 ? 3 : 0);

      if (e.kind === "car") {
        drawCarBody(e.x, e.y, e.r, "#1A1E2A", "#0E1320", "rgba(255,60,110,0.85)", damaged);
      } else if (e.kind === "van") {
        drawCarBody(e.x, e.y, e.r, "#22252E", "#11151F", "rgba(120,255,120,0.80)", damaged + 2);
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        roundRect(ctx, -e.r * 0.7, -e.r * 0.9, e.r * 1.4, e.r * 0.35, 6);
        ctx.fill();
        ctx.restore();
      } else {
        // truck
        ctx.save();
        ctx.translate(e.x, e.y);

        ctx.globalAlpha = 0.25;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.ellipse(0, 10, e.r * 1.2, e.r * 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        const g = ctx.createLinearGradient(0, -e.r, 0, e.r);
        g.addColorStop(0, "#2A2D38");
        g.addColorStop(1, "#11151F");
        ctx.fillStyle = g;
        roundRect(ctx, -e.r * 0.95, -e.r * 1.55, e.r * 1.9, e.r * 3.1, 10);
        ctx.fill();

        ctx.fillStyle = "rgba(230,240,255,0.18)";
        roundRect(ctx, -e.r * 0.75, -e.r * 1.25, e.r * 1.5, e.r * 0.9, 10);
        ctx.fill();

        ctx.globalAlpha = 0.8;
        ctx.fillStyle = "rgba(0,255,140,0.85)";
        ctx.beginPath(); ctx.ellipse(-e.r * 0.55, -e.r * 1.55, e.r * 0.20, e.r * 0.24, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse( e.r * 0.55, -e.r * 1.55, e.r * 0.20, e.r * 0.24, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

        if (damaged > 0) {
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = "rgba(20,20,20,0.9)";
          for (let i = 0; i < damaged; i++) {
            ctx.beginPath();
            ctx.arc(rand(-e.r * 0.7, e.r * 0.7), rand(-e.r * 1.0, e.r * 1.0), rand(2, 6), 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }

        ctx.restore();
      }
    }

    // player
    const inv = player.invuln > 0 ? 0.55 + 0.35 * Math.sin(world.time * 22) : 1;
    ctx.globalAlpha = inv;
    drawCarBody(player.x, player.y, player.r, "#1A2B3A", "#0B121C", "rgba(0,210,255,0.95)", 0);

    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "rgba(0,210,255,0.9)";
    ctx.beginPath();
    ctx.ellipse(player.x, player.y + 10, player.r * 1.2, player.r * 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

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

  // ===== Input =====
  const joy = { active: false, id: null, cx: 0, cy: 0, dx: 0, dy: 0, max: 46 };
  const joyEl = document.getElementById("joy");
  const knobEl = document.getElementById("joyKnob");

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
    dx = dx / len * m;
    dy = dy / len * m;

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

  let firing = false;
  function fireOn(ev) { firing = true; ev.preventDefault?.(); }
  function fireOff(ev) { firing = false; ev.preventDefault?.(); }

  fireBtn.addEventListener("touchstart", fireOn, { passive: false });
  fireBtn.addEventListener("touchend", fireOff, { passive: false });
  fireBtn.addEventListener("touchcancel", fireOff, { passive: false });
  fireBtn.addEventListener("mousedown", fireOn);
  window.addEventListener("mouseup", fireOff);

  canvas.addEventListener("touchstart", (ev) => {
    const t = ev.changedTouches[0];
    if (t.clientX > window.innerWidth * 0.55) firing = true;
  }, { passive: true });
  canvas.addEventListener("touchend", () => { firing = false; }, { passive: true });

  // ===== Mechanics =====
  function shoot(dt) {
    player.fireCooldown -= dt;
    if (!firing) return;
    if (player.fireCooldown > 0) return;

    player.fireCooldown = 1 / player.fireRate;
    const baseY = player.y - player.r - 2;

    const pattern =
      player.guns === 1 ? [0] :
      player.guns === 2 ? [-10, 10] :
      player.guns === 3 ? [-14, 0, 14] :
      [-22, -10, 0, 10, 22];

    const bw = 3 + Math.floor(player.dmg / 2);
    const bh = 14 + player.dmg * 1.2;

    const hue = clamp(player.bulletHue, 0, 210);
    const colMain = `hsla(${hue}, 95%, 65%, 0.95)`;
    const colGlow = `hsla(${hue}, 95%, 65%, 0.25)`;

    for (const dx of pattern) {
      bullets.push({
        x: player.x + dx,
        y: baseY,
        vy: -820,
        r: 4,
        col: colMain,
        glow: colGlow,
        bw,
        bh,
        dmg: player.dmg
      });
    }

    particles.push({
      x: player.x, y: baseY - 6,
      vx: rand(-60, 60), vy: rand(-80, -160),
      life: 0.2, t: 0, s: 10, kind: "spark"
    });
  }

  function hurtPlayer(amount) {
    if (player.invuln > 0) return;
    world.hp -= amount;
    player.invuln = 0.9;
    world.mult = 1;
    boom(player.x, player.y, 10);
  }

  function addScore(v) {
    world.score += v * world.mult;
  }

  function applyPickup(kind) {
    if (kind === "heal") {
      world.hp = Math.min(100, world.hp + 20);
      world.mult = Math.min(9, world.mult + 1);
    } else if (kind === "mult") {
      world.mult = Math.min(9, world.mult + 2);
      addScore(30);
    } else if (kind === "burst") {
      for (let i = -2; i <= 2; i++) {
        bullets.push({
          x: player.x + i * 6,
          y: player.y - player.r - 2,
          vy: -780,
          r: 4,
          col: "rgba(255,120,40,0.9)",
          glow: "rgba(255,120,40,0.25)",
          bw: 4,
          bh: 18,
          dmg: 1
        });
      }
      addScore(20);
    } else if (kind === "dmg") {
      player.dmg = Math.min(9, player.dmg + 1);
      // чем больше dmg — тем краснее (195 -> 175 -> ... -> 25)
      player.bulletHue = Math.max(25, player.bulletHue - 20);
      addScore(40);
    } else if (kind === "guns") {
      if (player.guns === 1) player.guns = 2;
      else if (player.guns === 2) player.guns = 3;
      else if (player.guns === 3) player.guns = 5;
      addScore(40);
    }
    world.shake = Math.min(10, world.shake + 3);
  }

  function step(dt) {
    world.time += dt;
    world.difficulty = 1 + world.time / 25;

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

    shoot(dt);

    // spawn enemies
    enemySpawnT -= dt;
    const spawnRate = clamp(0.55 - world.difficulty * 0.02, 0.18, 0.55);
    if (enemySpawnT <= 0) {
      enemySpawnT = spawnRate;
      spawnEnemy();
      if (Math.random() < 0.15) spawnEnemy();
    }

    // spawn pickups
    pickupSpawnT -= dt;
    if (pickupSpawnT <= 0) {
      pickupSpawnT = rand(3.2, 5.5);
      spawnPickup();
    }

    // bullets update
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.y += b.vy * dt;
      if (b.y < -40) bullets.splice(i, 1);
    }

    // enemies update + collision with player
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.shootT -= dt;

      e.x = clamp(e.x, roadX + 30, roadX + roadW - 30);

      const rr = (e.r + player.r) * (e.r + player.r);
      if (dist2(e.x, e.y, player.x, player.y) < rr) {
        enemies.splice(i, 1);
        hurtPlayer(14);
        continue;
      }

      if (e.y > H() + 80) enemies.splice(i, 1);
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

      if (p.y > H() + 40) pickups.splice(i, 1);
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
            vx: rand(-140, 140), vy: rand(-140, 140),
            life: 0.18, t: 0, s: 8, kind: "spark"
          });

          if (e.hp <= 0) {
            boom(e.x, e.y, 14);
            const score = e.kind === "truck" ? 35 : (e.kind === "van" ? 18 : 10);
            addScore(score);
            world.mult = Math.min(9, world.mult + 1);
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
    overlay.classList.remove("hidden");
    title.textContent = "Neon Car Shooter";
    subtitle.textContent = "Мрачный неон. Реальные тачки недалёкого будущего. Стреляй и выживай.";
    resetGame();
    draw();
  }

  boot();
})();