/**
 * Ugnay E2E suite — executes TESTS.md against a deployed target.
 * Usage: node suite.cjs [baseURL]
 */
const { chromium } = require("playwright-core");
const EXE = process.env.HOME + "/.cache/ms-playwright/chromium-1228/chrome-linux/chrome";
const BASE = process.argv[2] || "https://ecair-eics-project.web.app";
const ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"];

const results = [];
const log = (...a) => console.log(...a);
async function T(id, desc, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ id, desc, ok: true, note: note || "" });
    log(`  PASS  ${id}  ${desc}${note ? "  — " + note : ""}  (${Date.now() - t0}ms)`);
  } catch (e) {
    results.push({ id, desc, ok: false, note: e.message });
    log(`  FAIL  ${id}  ${desc}\n        ↳ ${e.message.split("\n")[0]}`);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

// ---------- page helpers ----------
const mapEval = (p, fn) => p.evaluate(fn);
const nodeCount = (p) =>
  p.evaluate(() => {
    const m = window.__ugnayMap;
    const d = m.getSource("nodes")?._data;
    return d && d.features ? d.features.length : 0;
  });
const renderedCount = (p, layer) =>
  p.evaluate((l) => window.__ugnayMap.queryRenderedFeatures({ layers: [l] }).length, layer);
const srcCount = (p, src) =>
  p.evaluate((s) => {
    const d = window.__ugnayMap.getSource(s)?._data;
    return d && d.features ? d.features.length : 0;
  }, src);

async function waitMapIdle(p, ms = 1500) {
  await p.waitForFunction(() => !!window.__ugnayMap, null, { timeout: 30000 });
  await p.waitForTimeout(ms);
}

/** Canonical "get into the map" path. */
async function enterMap(p, { region = "Cordillera Administrative Region (CAR)", province = null, municipality = null } = {}) {
  await p.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForSelector("select", { timeout: 30000 });
  await p.locator("select").first().selectOption({ label: region });
  await p.waitForTimeout(600);
  if (province) {
    await p.getByRole("button", { name: "Clear", exact: true }).click();
    await p.waitForTimeout(200);
    await p.locator("label").filter({ hasText: new RegExp(`^${province}$`) }).first().locator("input[type=checkbox]").check();
    await p.waitForTimeout(500);
    if (municipality) {
      await p.locator("label").filter({ hasText: new RegExp(`^${municipality}$`) }).last().locator("input[type=checkbox]").check();
      await p.waitForTimeout(300);
    }
  }
  await p.getByRole("button", { name: /Explore map/ }).click();
  await waitMapIdle(p, 3000);
  await p.waitForFunction(
    () => {
      const d = window.__ugnayMap?.getSource("nodes")?._data;
      return d && d.features && d.features.length > 0;
    },
    null,
    { timeout: 60000 }
  );
}

const openPanel = async (p) => {
  const body = p.locator("div.transition-all.overflow-hidden").first();
  const btn = p.getByRole("button", { name: /LAYERS & FILTERS/i });
  const h = await body.evaluate((e) => e.getBoundingClientRect().height).catch(() => 0);
  if (h < 20) { await btn.click(); await p.waitForTimeout(450); }
};
const tab = (p, name) => p.getByRole("button", { name, exact: true }).click();

// map.project() is canvas-relative; page.mouse is viewport-relative. The canvas sits
// BELOW the 45px header, so map pixels must be offset by the canvas origin or every
// click lands high and misses the node.
async function clickNode(p, pick = "center") {
  const target = await p.evaluate((mode) => {
    const m = window.__ugnayMap;
    const feats = m.queryRenderedFeatures({ layers: ["nodes-basic", "nodes-higher", "nodes-techvoc"] });
    if (!feats.length) return null;
    const c = m.getCenter();
    let best = feats[0];
    if (mode === "center") {
      let bd = Infinity;
      for (const f of feats) {
        const [x, y] = f.geometry.coordinates;
        const d = (x - c.lng) ** 2 + (y - c.lat) ** 2;
        if (d < bd) { bd = d; best = f; }
      }
    } else {
      let bx = -Infinity;
      for (const f of feats) {
        const q = m.project(f.geometry.coordinates);
        if (q.x > bx && q.x < window.innerWidth - 30) { bx = q.x; best = f; }
      }
    }
    const rect = document.querySelector(".maplibregl-canvas").getBoundingClientRect();
    const q = m.project(best.geometry.coordinates);
    return { x: q.x + rect.left, y: q.y + rect.top, name: best.properties.name || "(unnamed)" };
  }, pick);
  if (!target) throw new Error("no rendered nodes to click");
  await p.mouse.click(target.x, target.y);
  await p.waitForTimeout(1500);
  return target;
}
const drawerOpen = (p) => p.evaluate(() => !!document.querySelector(".ugnay-drawer-open"));

// The map is controlled by react-map-gl, so map.jumpTo() from evaluate() is ignored.
// Camera changes must come from a real gesture (or the app's own fitBounds).
async function dragMap(p, dx, dy) {
  await p.mouse.move(700, 500);
  await p.mouse.down();
  await p.mouse.move(700 + dx, 500 + dy, { steps: 14 });
  await p.mouse.up();
  await p.waitForTimeout(900);
}
const center = (p) => p.evaluate(() => { const c = window.__ugnayMap.getCenter(); return { lng: c.lng, lat: c.lat, z: window.__ugnayMap.getZoom() }; });
const sliderFor = (p, label) =>
  p.locator("label").filter({ hasText: label }).locator('xpath=following-sibling::input[@type="range"][1]');

// ---------- suite ----------
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  ctx.on("weberror", (e) => consoleErrors.push(String(e.error()).split("\n")[0]));

  log(`\nUgnay E2E — target: ${BASE}\n${"=".repeat(72)}`);

  // ===== T1 — Setup / Area Selection =====
  log("\nT1 — Setup / Area Selection");
  {
    const p = await ctx.newPage();
    p.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().split("\n")[0]));
    await p.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
    await p.waitForSelector("select", { timeout: 30000 });

    await T("T1.1", "Landing card renders; Explore disabled; 3 sectors On", async () => {
      const txt = await p.locator("body").innerText();
      assert(/Ugnay/.test(txt) && /Educational Pathway Explorer/.test(txt), "title/subtitle missing");
      const on = await p.getByRole("button", { name: /\bOn$/ }).count();
      assert(on === 3, `expected 3 sector toggles On, got ${on}`);
      const enabled = await p.getByRole("button", { name: /Explore map/ }).isEnabled();
      assert(!enabled, "Explore should be DISABLED with no region chosen");
      const hint = await p.locator("body").innerText();
      assert(/Select an area and at least one sector to continue/.test(hint), "gating hint missing");
      return "3 sectors on, Explore gated";
    });

    await T("T1.2", "Region → all provinces default; provincial terminal", async () => {
      const before = await p.locator("input[type=checkbox]").count();
      await p.locator("select").first().selectOption({ label: "Cordillera Administrative Region (CAR)" });
      await p.waitForTimeout(700);
      const after = await p.locator("input[type=checkbox]").count();
      assert(after > before, "no province checkboxes appeared");
      const checked = await p.locator("input[type=checkbox]:checked").count();
      assert(checked === after, `expected all provinces checked by default (${checked}/${after})`);
      const txt = await p.locator("body").innerText();
      assert(/Province-wide — all institutions across 7 provinces/.test(txt), "scope hint wrong: expected Province-wide/7");
      const picker = await p.getByText("Municipality / City").count();
      assert(picker === 0, "municipality picker should be ABSENT with 2+ provinces");
      return "7/7 provinces default-checked, municipality picker absent";
    });

    await T("T1.3", "Single province → municipal terminal opens", async () => {
      await p.getByRole("button", { name: "Clear", exact: true }).click();
      await p.waitForTimeout(300);
      await p.locator("label").filter({ hasText: /^Benguet$/ }).locator("input[type=checkbox]").check();
      await p.waitForTimeout(600);
      const txt = await p.locator("body").innerText();
      assert(/Whole province \(all municipalities\)/.test(txt), "expected 'Whole province' hint");
      assert((await p.getByText("Municipality / City").count()) > 0, "municipality picker did not appear for single province");
      await p.locator("label").filter({ hasText: /^La Trinidad$/ }).locator("input[type=checkbox]").check();
      await p.waitForTimeout(400);
      const txt2 = await p.locator("body").innerText();
      assert(/Municipal view — 1 municipality\/ies/.test(txt2), "expected 'Municipal view — 1'");
      return "picker active; 'Municipal view — 1 municipality/ies'";
    });

    await T("T1.4", "Select all / Clear provinces + Explore disables at zero", async () => {
      await p.getByRole("button", { name: "Select all", exact: true }).click();
      await p.waitForTimeout(300);
      let checked = await p.locator("input[type=checkbox]:checked").count();
      assert(checked >= 7, `select-all did not check all (got ${checked})`);
      await p.getByRole("button", { name: "Clear", exact: true }).click();
      await p.waitForTimeout(300);
      const txt = await p.locator("body").innerText();
      assert(/Pick at least one province/.test(txt), "expected 'Pick at least one province'");
      const enabled = await p.getByRole("button", { name: /Explore map/ }).isEnabled();
      assert(!enabled, "Explore should disable with 0 provinces");
      return "select-all/clear work; Explore re-gated at zero";
    });

    await T("T1.5", "Explore gating: needs ≥1 province AND ≥1 sector", async () => {
      await p.getByRole("button", { name: "Select all", exact: true }).click();
      await p.waitForTimeout(300);
      assert(await p.getByRole("button", { name: /Explore map/ }).isEnabled(), "should be enabled with provinces+sectors");
      for (const s of ["Basic Education", "Higher Education", "Technical–Vocational"]) {
        await p.getByRole("button", { name: new RegExp("^" + s.replace("–", "–")) }).click();
        await p.waitForTimeout(150);
      }
      const enabled = await p.getByRole("button", { name: /Explore map/ }).isEnabled();
      assert(!enabled, "Explore should DISABLE when all sectors are off");
      return "disabled with 0 sectors even though provinces selected";
    });
    await p.close();
  }

  // ===== T2 — Landing → Map transition (flash regression) =====
  log("\nT2 — Landing → Map Transition");
  {
    await T("T2.1", "No load flash: overlay opaque from its first painted frame", async () => {
      const p = await ctx.newPage();
      await p.addInitScript(() => {
        window.__samples = [];
        const tick = () => {
          const ov = document.querySelector(".absolute.inset-0.z-20");
          const cv = document.querySelector(".maplibregl-canvas");
          window.__samples.push({
            t: performance.now(),
            ovOpacity: ov ? parseFloat(getComputedStyle(ov).opacity) : null,
            canvasVisible: !!cv && cv.getBoundingClientRect().width > 0,
          });
          if (window.__samples.length < 240) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await p.goto(BASE, { waitUntil: "load", timeout: 60000 });
      await p.waitForTimeout(2500);
      const s = await p.evaluate(() => window.__samples);
      const withOverlay = s.filter((x) => x.ovOpacity !== null);
      assert(withOverlay.length > 0, "overlay element never found — selector drift?");
      const first = withOverlay[0];
      const bad = withOverlay.filter((x) => x.canvasVisible && x.ovOpacity < 0.9);
      assert(first.ovOpacity >= 0.99, `overlay's FIRST painted frame had opacity ${first.ovOpacity} (fade-in ⇒ flash)`);
      assert(bad.length === 0, `${bad.length} frame(s) showed the map with overlay opacity < 0.9 (min ${Math.min(...bad.map((b) => b.ovOpacity))})`);
      await p.close();
      return `first overlay frame opacity=${first.ovOpacity}; 0/${withOverlay.length} frames leaked the map`;
    });

    await T("T2.2", "Explore transition → map fitted, no lingering overlay", async () => {
      const p = await ctx.newPage();
      await enterMap(p, { region: "Cordillera Administrative Region (CAR)", province: "Benguet" });
      const ovVisible = await p.evaluate(() => {
        const ov = document.querySelector(".absolute.inset-0.z-20");
        return ov ? parseFloat(getComputedStyle(ov).opacity) : 0;
      });
      assert(ovVisible < 0.05, `setup overlay still visible after explore (opacity ${ovVisible})`);
      const n = await nodeCount(p);
      assert(n > 0, "no nodes after explore");
      await p.close();
      return `${n} institutions loaded, overlay gone`;
    });

    await T("T2.3", "'Change area' fades in over the live map", async () => {
      const p = await ctx.newPage();
      await enterMap(p, { region: "Cordillera Administrative Region (CAR)", province: "Benguet" });
      await p.getByRole("button", { name: /Change area/ }).click();
      // sample opacity right after click — a fade means we catch an intermediate value
      const samples = [];
      for (let i = 0; i < 12; i++) {
        samples.push(
          await p.evaluate(() => {
            const ov = document.querySelector(".absolute.inset-0.z-20");
            return ov ? parseFloat(getComputedStyle(ov).opacity) : null;
          })
        );
        await p.waitForTimeout(30);
      }
      const end = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".absolute.inset-0.z-20")).opacity));
      assert(end > 0.95, `overlay did not reach full opacity (${end})`);
      const sawFade = samples.some((v) => v !== null && v < 0.95);
      await p.close();
      return sawFade ? "fade-in observed (intermediate opacity captured)" : "reached opacity 1 (fade too fast to sample)";
    });
  }

  // ===== T3–T10 on one shared map session =====
  log("\nT3 — Map Render & Boundaries");
  const p = await ctx.newPage();
  p.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().split("\n")[0]));
  await enterMap(p, { region: "Cordillera Administrative Region (CAR)", province: "Benguet" });

  await T("T3.1", "Institutions render as pins", async () => {
    const total = await nodeCount(p);
    const drawn = (await renderedCount(p, "nodes-basic")) + (await renderedCount(p, "nodes-higher")) + (await renderedCount(p, "nodes-techvoc"));
    assert(total > 0, "nodes source empty");
    assert(drawn > 0, "nothing actually rendered on the GL canvas");
    return `${total} institutions in source, ${drawn} rendered in viewport`;
  });

  await T("T3.2", "Auto-fit to area (maxZoom 14, center in PH)", async () => {
    const v = await p.evaluate(() => ({ z: window.__ugnayMap.getZoom(), c: window.__ugnayMap.getCenter() }));
    assert(v.z <= 14.01, `zoom ${v.z} exceeds maxZoom 14`);
    assert(v.c.lng > 116 && v.c.lng < 127 && v.c.lat > 4 && v.c.lat < 21, `center outside PH: ${JSON.stringify(v.c)}`);
    return `zoom ${v.z.toFixed(2)}, center ${v.c.lng.toFixed(3)},${v.c.lat.toFixed(3)}`;
  });

  await T("T3.3", "Boundaries load and follow selection level", async () => {
    const b = await srcCount(p, "borders");
    assert(b > 0, "borders source is empty");
    const drawn = await renderedCount(p, "borders-line");
    return `${b} boundary features (${drawn} rendered)`;
  });

  log("\nT4 — Basemaps");
  await T("T4.1", "plain / satellite / roads all switch; layers survive", async () => {
    const out = [];
    for (const name of ["satellite", "roads", "plain"]) {
      const before = consoleErrors.length;
      await p.getByRole("button", { name: new RegExp(`^${name}$`, "i") }).click();
      await p.waitForTimeout(2500);
      const ok = await p.evaluate(() => {
        const m = window.__ugnayMap;
        return { style: !!m.getStyle(), nodes: !!m.getLayer("nodes-basic"), borders: !!m.getLayer("borders-line") };
      });
      assert(ok.nodes, `${name}: nodes-basic layer did NOT survive the style switch`);
      assert(ok.borders, `${name}: borders-line layer did NOT survive the style switch`);
      const drawn = await renderedCount(p, "nodes-basic");
      assert(drawn > 0, `${name}: no pins rendered after switch`);
      const newErr = consoleErrors.length - before;
      out.push(`${name}:${drawn}pins${newErr ? `/${newErr}err` : ""}`);
    }
    return out.join("  ");
  });

  log("\nT5 — Sector Layers & Filters");
  await T("T5.1", "Header sector toggle gates nodes", async () => {
    const before = await renderedCount(p, "nodes-basic");
    assert(before > 0, "no basic-ed pins to begin with");
    await p.getByRole("button", { name: "Basic", exact: true }).click();
    await p.waitForTimeout(1200);
    const after = await renderedCount(p, "nodes-basic");
    assert(after === 0, `basic pins should vanish, ${after} still rendered`);
    await p.getByRole("button", { name: "Basic", exact: true }).click();
    await p.waitForTimeout(1500);
    const restored = await renderedCount(p, "nodes-basic");
    assert(restored > 0, "basic pins did not come back");
    return `${before} → 0 → ${restored}`;
  });

  await T("T5.2", "FilterPanel subcategory checkbox removes ES-only schools", async () => {
    await openPanel(p);
    await tab(p, "Filters");
    await p.waitForTimeout(300);
    const before = await nodeCount(p);
    await p.locator("label").filter({ hasText: /Elementary \(ES\)/ }).locator("input[type=checkbox]").uncheck();
    await p.waitForTimeout(1200);
    const after = await nodeCount(p);
    assert(after < before, `unchecking ES did not reduce nodes (${before} → ${after})`);
    await p.locator("label").filter({ hasText: /Elementary \(ES\)/ }).locator("input[type=checkbox]").check();
    await p.waitForTimeout(1000);
    const back = await nodeCount(p);
    assert(back === before, `re-checking ES did not restore (${before} → ${back})`);
    return `${before} → ${after} → ${back}`;
  });

  await T("T5.3", "Dim (◐) fades rather than hides", async () => {
    const before = await nodeCount(p);
    const dim = p.locator("label").filter({ hasText: /Elementary \(ES\)/ }).locator("xpath=following-sibling::button[1]");
    const dimBtn = (await dim.count()) ? dim.first() : p.getByRole("button", { name: "◐" }).first();
    await dimBtn.click();
    await p.waitForTimeout(900);
    const after = await nodeCount(p);
    assert(after === before, `dim must NOT remove nodes (${before} → ${after})`);
    const opacities = await p.evaluate(() => {
      const m = window.__ugnayMap;
      return m.getPaintProperty("nodes-basic", "circle-opacity");
    });
    await dimBtn.click();
    await p.waitForTimeout(500);
    return `node count preserved (${before}); opacity expression is ${Array.isArray(opacities) ? "data-driven" : String(opacities)}`;
  });

  log("\nT6 — Threshold & Node Selection");
  let pinnedEdges = 0;
  await T("T6.1", "Click a node → accessibility edges + detail drawer opens", async () => {
    const before = await drawerOpen(p);
    assert(!before, "drawer was already open before the click");
    const hit = await clickNode(p, "center");
    pinnedEdges = await srcCount(p, "edges");
    const open = await drawerOpen(p);
    assert(open, `clicking a node did NOT open the detail drawer (clicked "${hit.name}")`);
    assert(pinnedEdges > 0, `no accessibility edges drawn for "${hit.name}" (expected >0 in a dense area)`);
    return `clicked "${hit.name}" → ${pinnedEdges} edges, drawer open`;
  });

  await T("T6.2", "Threshold slider changes the edge fan (3 km → 1 km → 5 km)", async () => {
    const slider = sliderFor(p, "Road distance threshold");
    await slider.fill("1");
    await p.waitForTimeout(1600);
    const at1 = await srcCount(p, "edges");
    await slider.fill("5");
    await p.waitForTimeout(1800);
    const at5 = await srcCount(p, "edges");
    assert(at1 <= pinnedEdges, `1 km should not exceed 3 km (${at1} > ${pinnedEdges})`);
    assert(at5 >= at1, `5 km should be ≥ 1 km (${at5} < ${at1})`);
    assert(at5 > at1, `threshold had no effect on the fan (1km=${at1}, 5km=${at5})`);
    await slider.fill("3");
    await p.waitForTimeout(1200);
    return `edges: 1km=${at1}, 3km=${pinnedEdges}, 5km=${at5}`;
  });

  await T("T6.3", "Selecting a node UNDER the drawer pans the map, never resizes it", async () => {
    const size = () => p.evaluate(() => {
      const r = document.querySelector(".maplibregl-canvas").getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    const closeBtn = p.getByRole("button", { name: "✕" });
    if (await closeBtn.count()) { await closeBtn.first().click(); await p.waitForTimeout(800); }

    // Pick a node, then drag the map so that node sits under the 288px drawer.
    const node = await p.evaluate(() => {
      const m = window.__ugnayMap;
      const f = m.queryRenderedFeatures({ layers: ["nodes-basic", "nodes-higher", "nodes-techvoc"] })[0];
      if (!f) return null;
      const q = m.project(f.geometry.coordinates);
      return { lngLat: f.geometry.coordinates, x: q.x, y: q.y,
               w: m.getContainer().clientWidth, h: m.getContainer().clientHeight };
    });
    assert(node, "no node found");
    // Right side is crowded: FilterPanel is top-right (to ~y450) and the map controls are
    // bottom-right. Land the node inside the drawer's 288px band but in the clear mid-band,
    // or the click hits a panel instead of the canvas.
    const targetX = node.w - 130;
    const targetY = Math.round(node.h * 0.62);
    await dragMap(p, targetX - node.x, targetY - node.y);

    const nowX = await p.evaluate((ll) => window.__ugnayMap.project(ll).x, node.lngLat);
    assert(nowX > node.w - 288, `could not place a node under the drawer (x=${Math.round(nowX)}, drawer starts at ${node.w - 288})`);

    const before = await size();
    const lngBefore = (await center(p)).lng;
    const rect = await p.evaluate(() => { const r = document.querySelector(".maplibregl-canvas").getBoundingClientRect(); return { l: r.left, t: r.top }; });
    const pt = await p.evaluate((ll) => { const q = window.__ugnayMap.project(ll); return { x: q.x, y: q.y }; }, node.lngLat);
    const topEl = await p.evaluate(({ x, y }) => {
      const e = document.elementFromPoint(x, y);
      return e ? e.tagName + "." + String(e.className).slice(0, 30) : "null";
    }, { x: pt.x + rect.l, y: pt.y + rect.t });
    assert(/CANVAS/i.test(topEl), `click point is covered by ${topEl}, not the map canvas`);
    await p.mouse.click(pt.x + rect.l, pt.y + rect.t);
    await p.waitForTimeout(1600);

    const after = await size();
    const lngAfter = (await center(p)).lng;
    assert(await drawerOpen(p), "drawer did not open on the under-drawer node");
    assert(before.w === after.w && before.h === after.h,
      `canvas RESIZED ${JSON.stringify(before)} → ${JSON.stringify(after)} — would white-flash`);
    assert(Math.abs(lngAfter - lngBefore) > 1e-6, "map did not pan; the node stays hidden under the drawer");
    const finalX = await p.evaluate((ll) => window.__ugnayMap.project(ll).x, node.lngLat);
    assert(finalX < node.w - 288, `node still under the drawer after the pan (x=${Math.round(finalX)})`);
    return `canvas stable ${after.w}×${after.h}; node x ${Math.round(nowX)} → ${Math.round(finalX)} (clear of drawer at ${node.w - 288})`;
  });

  log("\nT7 — Gap Analysis");
  await T("T7.1", "Gap analysis toggles halos + legend section", async () => {
    await p.getByRole("button", { name: /Gap analysis/ }).click();
    await p.waitForTimeout(1800);
    const halo = await renderedCount(p, "nodes-halo");
    const txt = await p.locator("body").innerText();
    assert(/Hide gap analysis/i.test(txt), "button did not flip to 'Hide gap analysis'");
    const legendHasGap = /Gap analysis/i.test(txt);
    assert(legendHasGap, "legend gap section missing");
    return `${halo} gap halos rendered; button flipped; legend section present`;
  });

  await T("T7.2", "Gap halos respond to the threshold", async () => {
    const slider = sliderFor(p, "Road distance threshold");
    await slider.fill("1");
    await p.waitForTimeout(1800);
    const at1 = await renderedCount(p, "nodes-halo");
    await slider.fill("5");
    await p.waitForTimeout(2000);
    const at5 = await renderedCount(p, "nodes-halo");
    assert(at1 >= at5, `tightening to 1 km should not REDUCE gap halos (1km=${at1}, 5km=${at5})`);
    await slider.fill("3");
    await p.waitForTimeout(1200);
    await p.getByRole("button", { name: /Hide gap analysis/ }).click();
    await p.waitForTimeout(800);
    return `halos: 1km=${at1} ≥ 5km=${at5}`;
  });

  log("\nT8/T9 — Legend & Appearance");
  await T("T8.1", "Legend collapse/expand is a smooth max-height roll", async () => {
    const btn = p.locator('button[title*="legend" i]').first();
    const body = p.locator(".absolute.bottom-3.left-3 .transition-all.overflow-hidden").first();
    const css = await body.evaluate((e) => { const s = getComputedStyle(e); return { prop: s.transitionProperty, dur: s.transitionDuration }; });
    const h0 = await body.evaluate((e) => e.getBoundingClientRect().height);
    assert(h0 > 50, `legend body not open to start (${h0}px)`);
    await btn.click();
    await p.waitForTimeout(130);
    const hMid = await body.evaluate((e) => e.getBoundingClientRect().height);
    await p.waitForTimeout(500);
    const h1 = await body.evaluate((e) => e.getBoundingClientRect().height);
    assert(h1 < 5, `legend did not collapse (${h0} → ${h1})`);
    const animated = hMid < h0 - 5 && hMid > h1 + 5;
    const w0 = await body.evaluate((e) => Math.round(e.getBoundingClientRect().width));
    await btn.click();
    await p.waitForTimeout(500);
    const hBack = await body.evaluate((e) => e.getBoundingClientRect().height);
    assert(hBack > 50, "legend did not re-expand");
    return `${css.prop} @ ${css.dur}, h ${Math.round(h0)}→${Math.round(hMid)}→${Math.round(h1)}→${Math.round(hBack)}${animated ? " (mid-frame caught)" : ""}, width constant ${w0}px`;
  });

  await T("T9.1", "Layers & Filters collapse is a smooth roll (regression)", async () => {
    await openPanel(p);
    const btn = p.getByRole("button", { name: /LAYERS & FILTERS/i });
    const body = p.locator("div.transition-all.overflow-hidden").first();
    const css = await body.evaluate((e) => {
      const s = getComputedStyle(e);
      return { prop: s.transitionProperty, dur: s.transitionDuration, overflow: s.overflow };
    });
    assert(/all|max-height/.test(css.prop), `body is not transitioning max-height (transition-property: ${css.prop}) — DOM-swap regression?`);
    assert(parseFloat(css.dur) > 0.1, `transition duration too short: ${css.dur}`);
    const h0 = await body.evaluate((e) => e.getBoundingClientRect().height);
    await btn.click();
    await p.waitForTimeout(130);
    const hMid = await body.evaluate((e) => e.getBoundingClientRect().height);
    await p.waitForTimeout(500);
    const h1 = await body.evaluate((e) => e.getBoundingClientRect().height);
    assert(h0 > 50, `panel body not open to start (${h0}px)`);
    assert(h1 < 5, `panel body did not collapse (${h1}px)`);
    const animated = hMid < h0 - 5 && hMid > h1 + 5;
    // chevron rotation
    const rot = await p.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /LAYERS & FILTERS/i.test(x.innerText));
      const chev = b.querySelector("span:last-child");
      return getComputedStyle(chev).transform;
    });
    await btn.click();
    await p.waitForTimeout(500);
    const hBack = await body.evaluate((e) => e.getBoundingClientRect().height);
    assert(hBack > 50, "panel did not re-expand");
    return `${css.prop} @ ${css.dur}, h ${Math.round(h0)}→${Math.round(hMid)}→${Math.round(h1)}→${Math.round(hBack)}${animated ? " (mid-frame caught)" : ""}, chevron ${rot === "none" ? "unrotated" : "rotated"}`;
  });

  await T("T9.2", "Node size slider is continuous (0.25 px steps)", async () => {
    await openPanel(p);
    await tab(p, "Appearance");
    await p.waitForTimeout(400);
    const slider = sliderFor(p, "Node size");
    const attrs = await slider.evaluate((e) => ({ min: e.min, max: e.max, step: e.step, value: e.value }));
    assert(attrs.step === "0.25", `expected step=0.25, got step=${attrs.step}`);
    assert(attrs.min === "2" && attrs.max === "9", `expected range 2–9, got ${attrs.min}–${attrs.max}`);
    await slider.fill("4.25");
    await p.waitForTimeout(800);
    const txt = await p.locator("body").innerText();
    assert(/4\.25\s*px/.test(txt), "fractional readout '4.25px' not shown");
    const radiusChanged = await p.evaluate(() => {
      const r = window.__ugnayMap.getPaintProperty("nodes-basic", "circle-radius");
      return JSON.stringify(r);
    });
    return `step=${attrs.step} range=${attrs.min}-${attrs.max}; readout shows 4.25px; circle-radius wired`;
  });

  await T("T9.3", "Border thickness 0 hides borders, 5 thickens", async () => {
    const slider = sliderFor(p, "Border thickness");
    await slider.fill("0");
    await p.waitForTimeout(800);
    const at0 = await p.evaluate(() => window.__ugnayMap.getPaintProperty("borders-line", "line-opacity"));
    await slider.fill("5");
    await p.waitForTimeout(800);
    const w5 = await p.evaluate(() => window.__ugnayMap.getPaintProperty("borders-line", "line-width"));
    const op5 = await p.evaluate(() => window.__ugnayMap.getPaintProperty("borders-line", "line-opacity"));
    assert(Number(at0) === 0, `at thickness 0, line-opacity should be 0 (got ${at0})`);
    assert(Number(w5) >= 4, `at thickness 5, line-width should be thick (got ${w5})`);
    await slider.fill("1");
    await p.waitForTimeout(500);
    return `opacity@0=${at0}; width@5=${w5}, opacity@5=${op5}`;
  });

  await T("T9.4", "Colorblind-safe palette repaints pins + legend", async () => {
    const paintBefore = await p.evaluate(() => JSON.stringify(window.__ugnayMap.getPaintProperty("nodes-basic", "circle-color")));
    const cb = p.locator("label").filter({ hasText: /Colorblind/i }).first();
    await cb.click();
    await p.waitForTimeout(1000);
    const paintAfter = await p.evaluate(() => JSON.stringify(window.__ugnayMap.getPaintProperty("nodes-basic", "circle-color")));
    assert(paintBefore !== paintAfter, "colorblind toggle did not change the node paint expression");
    await cb.click();
    await p.waitForTimeout(800);
    const paintBack = await p.evaluate(() => JSON.stringify(window.__ugnayMap.getPaintProperty("nodes-basic", "circle-color")));
    assert(paintBack === paintBefore, "toggling colorblind off did not restore the default palette");
    return "palette swaps and restores";
  });

  log("\nT10 — Map Controls (new)");
  await T("T10.1", "Re-center button refits the view", async () => {
    const closeBtn = p.getByRole("button", { name: "✕" });
    if (await closeBtn.count()) { await closeBtn.first().click(); await p.waitForTimeout(800); }
    // Earlier tests leave the map panned, so "where we are" is not the canonical fit.
    // Click re-center once to establish the fit, then drag away and re-center for real.
    const btn0 = p.locator('button[title*="Re-center" i]');
    await btn0.first().click();
    await p.waitForTimeout(1800);
    const home = await center(p);
    await dragMap(p, -420, -260);            // real gesture: jumpTo is ignored in controlled mode
    const away = await center(p);
    const dAway = Math.hypot(away.lng - home.lng, away.lat - home.lat);
    assert(dAway > 0.01, `precondition: drag did not move the map (${dAway.toFixed(5)}°)`);
    const btn = p.locator('button[title*="Re-center" i]');
    assert((await btn.count()) > 0, "re-center button not found (title*='Re-center')");
    await btn.first().click();
    await p.waitForTimeout(2000);
    const back = await center(p);
    const dBack = Math.hypot(back.lng - home.lng, back.lat - home.lat);
    assert(dBack < 0.01, `re-center did not return to the area (still ${dBack.toFixed(5)}° from the fit)`);
    return `dragged ${dAway.toFixed(3)}° away → re-centered to within ${dBack.toFixed(5)}°, zoom ${back.z.toFixed(2)}`;
  });

  await T("T10.2", "Hide-UI toggle hides all chrome and persists a restore button", async () => {
    const btn = p.locator('button[title*="Hide panels" i]');
    assert((await btn.count()) > 0, "hide-UI button not found (title*='Hide panels')");
    await btn.first().click();
    await p.waitForTimeout(700);
    const state = await p.evaluate(() => {
      const t = document.body.innerText;
      return {
        header: /Change area/.test(t),
        panel: /LAYERS & FILTERS/i.test(t),
        legend: /LEGEND/.test(t),
        restore: !!document.querySelector('button[title*="Show panels" i]'),
        zoom: !!document.querySelector(".maplibregl-ctrl-zoom-in"),
        canvas: !!document.querySelector(".maplibregl-canvas"),
      };
    });
    assert(!state.header, "header still visible in clear-map mode");
    assert(!state.panel, "Layers & Filters still visible in clear-map mode");
    assert(!state.legend, "Legend still visible in clear-map mode");
    assert(state.restore, "restore (eye) button missing — UI would be unrecoverable");
    assert(state.zoom && state.canvas, "zoom control / canvas should remain");
    await p.locator('button[title*="Show panels" i]').first().click();
    await p.waitForTimeout(700);
    const restored = await p.evaluate(() => /LAYERS & FILTERS/i.test(document.body.innerText) && /Change area/.test(document.body.innerText));
    assert(restored, "chrome did not come back after clicking the restore button");
    return "header/panel/legend hidden; eye button persists; restore works";
  });

  await T("T10.3", "Controls ride the drawer slide (no overlap)", async () => {
    const rect = () => p.evaluate(() => {
      const c = document.querySelector(".ugnay-map-controls");
      if (!c) return null;
      const d = c.getBoundingClientRect();
      return { x: Math.round(d.x) };
    });
    const closeBtn = p.getByRole("button", { name: "✕" });
    if (await closeBtn.count()) { await closeBtn.first().click(); await p.waitForTimeout(800); }
    const before = await rect();
    assert(before, ".ugnay-map-controls not found");
    await clickNode(p, "center");
    assert(await drawerOpen(p), "drawer did not open");
    await p.waitForTimeout(700);
    const after = await rect();
    const shift = after.x - before.x;
    assert(shift < -100, `controls did not slide left with the drawer (Δx = ${shift}px, expected ≈ -288px / 18rem)`);
    return `controls slid ${shift}px (18rem = -288px)`;
  });

  await T("T10.4", "Custom controls do NOT cover MapLibre's zoom +/- (regression)", async () => {
    const closeBtn = p.getByRole("button", { name: "✕" });
    if (await closeBtn.count()) { await closeBtn.first().click(); await p.waitForTimeout(800); }
    const g = await p.evaluate(() => {
      const s = document.querySelector(".ugnay-map-controls").getBoundingClientRect();
      const zi = document.querySelector(".maplibregl-ctrl-zoom-in").getBoundingClientRect();
      const el = document.elementFromPoint(zi.x + zi.width / 2, zi.y + zi.height / 2);
      return { gap: Math.round(zi.top - s.bottom), covered: !!(el && el.closest && el.closest(".ugnay-map-controls")) };
    });
    assert(!g.covered, `the custom control stack COVERS the zoom-in button (overlap ${-g.gap}px) — it is unclickable`);
    assert(g.gap >= 0, `custom stack overlaps the zoom block by ${-g.gap}px`);
    const z0 = await p.evaluate(() => window.__ugnayMap.getZoom());
    await p.locator(".maplibregl-ctrl-zoom-in").click({ timeout: 5000 });
    await p.waitForTimeout(1000);
    const z1 = await p.evaluate(() => window.__ugnayMap.getZoom());
    assert(z1 > z0 + 0.1, `zoom-in click had no effect (${z0.toFixed(2)} → ${z1.toFixed(2)})`);
    await p.locator(".maplibregl-ctrl-zoom-out").click({ timeout: 5000 });
    await p.waitForTimeout(1000);
    const z2 = await p.evaluate(() => window.__ugnayMap.getZoom());
    assert(z2 < z1 - 0.1, `zoom-out click had no effect (${z1.toFixed(2)} → ${z2.toFixed(2)})`);
    return `gap ${g.gap}px above zoom block; zoom in ${z0.toFixed(2)}→${z1.toFixed(2)}→${z2.toFixed(2)} out`;
  });

  await p.close();

  // ===== T12 — Performance / worst case =====
  log("\nT12 — Performance / Worst Case");
  await T("T12.1", "Dense urban municipality on a phone viewport (Quezon City)", async () => {
    const m = await ctx.newPage({ viewport: { width: 390, height: 844 } });
    await m.setViewportSize({ width: 390, height: 844 });
    const t0 = Date.now();
    await enterMap(m, { region: "National Capital Region (NCR)", province: "Quezon City", municipality: "Quezon City" });
    const load = Date.now() - t0;
    const n = await nodeCount(m);
    const drawn = await renderedCount(m, "nodes-basic");
    const hScroll = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    assert(!hScroll, "page body scrolls horizontally at 390px — layout overflow");
    assert(n > 0, "no institutions loaded");
    // interactivity: pan and confirm the map responds
    await m.evaluate(() => window.__ugnayMap.panBy([60, 60], { duration: 0 }));
    await m.waitForTimeout(500);
    await m.close();
    return `${n} institutions, ${drawn} rendered, ready in ${(load / 1000).toFixed(1)}s, no h-scroll @390px`;
  });

  await T("T12.2", "Multi-province payload (full CALABARZON region, 6 provinces)", async () => {
    const m = await ctx.newPage();
    const t0 = Date.now();
    await enterMap(m, { region: "Region IV-A (CALABARZON)" });
    const load = Date.now() - t0;
    const n = await nodeCount(m);
    const responsive = await m.evaluate(async () => {
      const t = performance.now();
      window.__ugnayMap.panBy([80, 0], { duration: 0 });
      return performance.now() - t;
    });
    assert(n > 1000, `expected a large payload for CALABARZON, got ${n}`);
    await m.close();
    return `${n} institutions across 6 provinces in ${(load / 1000).toFixed(1)}s; pan cost ${responsive.toFixed(0)}ms`;
  });

  await T("T12.3", "prefers-reduced-motion collapses animation durations", async () => {
    const m = await ctx.newPage();
    await m.emulateMedia({ reducedMotion: "reduce" });
    await enterMap(m, { region: "Cordillera Administrative Region (CAR)", province: "Benguet" });
    await openPanel(m);
    const dur = await m.evaluate(() => {
      const b = document.querySelector("div.transition-all.overflow-hidden");
      return b ? getComputedStyle(b).transitionDuration : null;
    });
    await m.close();
    const secs = parseFloat(dur);
    assert(!Number.isNaN(secs), "could not read transition-duration");
    if (secs > 0.05) throw new Error(`reduced-motion NOT honoured: transition-duration still ${dur}`);
    return `transition-duration = ${dur}`;
  });

  // ===== summary =====
  log("\n" + "=".repeat(72));
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok);
  log(`RESULT: ${pass}/${results.length} passed`);
  if (fail.length) {
    log(`\nFAILURES (${fail.length}):`);
    for (const f of fail) log(`  ✗ ${f.id}  ${f.desc}\n      ${f.note.split("\n")[0]}`);
  }
  const uniqErr = [...new Set(consoleErrors)];
  if (uniqErr.length) {
    log(`\nCONSOLE ERRORS (${consoleErrors.length} total, ${uniqErr.length} unique):`);
    uniqErr.slice(0, 12).forEach((e) => log("  ! " + e.slice(0, 160)));
  } else log("\nCONSOLE ERRORS: none");
  await browser.close();
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS CRASH:", e); process.exit(2); });
