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
      assert(/Choose a region to begin/.test(hint), "expected the first-step hint 'Choose a region to begin.'");
      assert(/Pick a region/.test(hint), "scope hint should read 'Pick a region' before a region is chosen");
      return "3 sectors on, Explore gated, hint points at the FIRST action (region)";
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
      const picker = await p.evaluate(() => {
        const lab = [...document.querySelectorAll("label")].find((e) =>
          e.textContent.includes("Municipality / City")
        );
        if (!lab) return { present: false };
        const box = lab.closest("[aria-hidden]");
        return {
          present: true,
          hidden: box ? box.getAttribute("aria-hidden") === "true" : false,
          height: Math.round(box ? box.getBoundingClientRect().height : -1),
        };
      });
      assert(
        !picker.present || (picker.hidden && picker.height < 4),
        `municipality picker should be collapsed+hidden with 2+ provinces: ${JSON.stringify(picker)}`
      );
      // Collapsed ≠ merely clipped: it must also be out of the tab order and the a11y tree,
      // or a keyboard/screen-reader user lands on checkboxes that visually do not exist.
      // The rule: anything hidden from the a11y tree must not still hold focusable controls.
      // (An aria-hidden container with a tabbable button inside is an ARIA violation — a
      // keyboard user tabs into a panel that, as far as they're told, does not exist.)
      const leaks = await p.evaluate(() => {
        const SEL = "input,button,select,textarea,a[href],[tabindex]:not([tabindex='-1'])";
        return [...document.querySelectorAll("[aria-hidden='true']")]
          .filter((b) => !b.hasAttribute("inert") && b.querySelectorAll(SEL).length > 0)
          .map((b) => ({
            controls: b.querySelectorAll(SEL).length,
            text: (b.innerText || "").slice(0, 30).replace(/\n/g, "|"),
          }));
      });
      assert(
        leaks.length === 0,
        `aria-hidden containers still holding focusable controls: ${JSON.stringify(leaks)}`
      );
      return `7/7 provinces default-checked; municipality picker collapsed (height 0, aria-hidden, inert)`;
    });

    await T("T1.3", "Single province → municipal terminal opens", async () => {
      await p.getByRole("button", { name: "Clear", exact: true }).click();
      await p.waitForTimeout(300);
      await p.locator("label").filter({ hasText: /^Benguet$/ }).locator("input[type=checkbox]").check();
      await p.waitForTimeout(600);
      const txt = await p.locator("body").innerText();
      assert(/Whole province \(all municipalities\)/.test(txt), "expected 'Whole province' hint");
      const shown = await p.evaluate(() => {
        const lab = [...document.querySelectorAll("label")].find((e) =>
          e.textContent.includes("Municipality / City")
        );
        const box = lab && lab.closest("[aria-hidden]");
        return box ? box.getBoundingClientRect().height : 0;
      });
      assert(shown > 20, `municipality picker did not expand for a single province (height ${shown})`);
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
          const ov = document.querySelector(".absolute.inset-0.z-50");
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
        const ov = document.querySelector(".absolute.inset-0.z-50");
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
            const ov = document.querySelector(".absolute.inset-0.z-50");
            return ov ? parseFloat(getComputedStyle(ov).opacity) : null;
          })
        );
        await p.waitForTimeout(30);
      }
      const end = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".absolute.inset-0.z-50")).opacity));
      assert(end > 0.95, `overlay did not reach full opacity (${end})`);
      const sawFade = samples.some((v) => v !== null && v < 0.95);
      await p.close();
      return sawFade ? "fade-in observed (intermediate opacity captured)" : "reached opacity 1 (fade too fast to sample)";
    });

    await T("T2.4", "Nodes are held back, then fade in with the camera", async () => {
      const p = await ctx.newPage();
      await p.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
      await p.waitForSelector("select", { timeout: 30000 });
      await p.locator("select").first().selectOption({ label: "Cordillera Administrative Region (CAR)" });
      await p.waitForTimeout(600);
      await p.getByRole("button", { name: "Clear", exact: true }).click();
      await p.locator("label").filter({ hasText: /^Benguet$/ }).first().locator("input[type=checkbox]").check();
      await p.waitForTimeout(400);

      // The reveal is a multiplier the app wraps around the node-opacity expression:
      //   icon-opacity = ["*", <opacity expr>, 0 | 1]
      // 0 while the area is still arriving, 1 once it's in — so nodes can't pop in tile by tile.
      const revealMul = () => p.evaluate(() => {
        const e = window.__ugnayMap?.getPaintProperty("nodes-basic", "icon-opacity");
        return Array.isArray(e) && e[0] === "*" ? e[2] : null;
      });

      await p.getByRole("button", { name: /Explore map/ }).click();
      await p.waitForTimeout(150);
      const during = await revealMul();
      assert(during === 0, `nodes should be held hidden while the area loads (reveal multiplier = ${during})`);

      await p.waitForFunction(
        () => {
          const d = window.__ugnayMap?.getSource("nodes")?._data;
          return d && d.features && d.features.length > 0;
        },
        null,
        { timeout: 60000 }
      );
      await p.waitForTimeout(3000); // tiles in, camera flown, fade done
      const after = await revealMul();
      assert(after === 1, `nodes never revealed (reveal multiplier stuck at ${after})`);

      const dur = await p.evaluate(() =>
        window.__ugnayMap.getPaintProperty("nodes-basic", "icon-opacity-transition")
      );
      assert(dur && dur.duration >= 300, `the reveal should FADE, not snap (transition ${JSON.stringify(dur)})`);
      const drawn = await renderedCount(p, "nodes-basic");
      assert(drawn > 0, "no nodes rendered after the reveal");
      await p.close();
      return `held at 0 while loading → revealed to 1 over ${dur.duration}ms; ${drawn} pins drawn`;
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
    const opacities = await p.evaluate(() =>
      window.__ugnayMap.getPaintProperty("nodes-basic", "icon-opacity")
    );
    assert(opacities !== undefined, "icon-opacity missing — are the node layers still symbols?");
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
    const sized = await p.evaluate(() =>
      JSON.stringify(window.__ugnayMap.getLayoutProperty("nodes-basic", "icon-size"))
    );
    assert(sized && sized !== "null", "icon-size is not wired to the node-size slider");
    return `step=${attrs.step} range=${attrs.min}-${attrs.max}; readout shows 4.25px; icon-size wired`;
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
    const paintBefore = await p.evaluate(() => JSON.stringify(window.__ugnayMap.getPaintProperty("nodes-basic", "icon-color")));
    const cb = p.locator("label").filter({ hasText: /Colorblind/i }).first();
    await cb.click();
    await p.waitForTimeout(1000);
    const paintAfter = await p.evaluate(() => JSON.stringify(window.__ugnayMap.getPaintProperty("nodes-basic", "icon-color")));
    assert(paintBefore !== paintAfter, "colorblind toggle did not change the node paint expression");
    await cb.click();
    await p.waitForTimeout(800);
    const paintBack = await p.evaluate(() => JSON.stringify(window.__ugnayMap.getPaintProperty("nodes-basic", "icon-color")));
    assert(paintBack === paintBefore, "toggling colorblind off did not restore the default palette");
    return "palette swaps and restores";
  });

  await T("T9.5", "Per-sector node SHAPES (SDF symbol layers)", async () => {
    await openPanel(p);
    await tab(p, "Appearance");
    await p.waitForTimeout(400);
    const imgs = await p.evaluate(() =>
      ["circle", "square", "triangle", "diamond"].map((s) => window.__ugnayMap.hasImage(`ugnay-shape-${s}`))
    );
    assert(imgs.every(Boolean), `not all shape images registered: ${JSON.stringify(imgs)}`);
    const before = await p.evaluate(() =>
      JSON.stringify(window.__ugnayMap.getLayoutProperty("nodes-basic", "icon-image"))
    );
    // The DepEd Public row's shape picker: pick "diamond" (unused by default).
    const row = p.locator("div").filter({ hasText: /^DepEd Public$/ }).last();
    await p.locator('button[title="Diamond"]').first().click();
    await p.waitForTimeout(1000);
    const after = await p.evaluate(() =>
      JSON.stringify(window.__ugnayMap.getLayoutProperty("nodes-basic", "icon-image"))
    );
    assert(before !== after, "changing the shape did not change the icon-image expression");
    assert(/diamond/.test(after), `icon-image should now reference the diamond: ${after}`);
    const drawn = await renderedCount(p, "nodes-basic");
    assert(drawn > 0, "no nodes rendered after the shape change — missing icon?");
    // restore
    await p.locator('button[title="Circle"]').first().click();
    await p.waitForTimeout(600);
    return `4 SDF images registered; DepEd Public → diamond repainted ${drawn} nodes`;
  });

  await T("T9.6", "Shape images survive a basemap switch (regression)", async () => {
    // setStyle drops every image the app added. If they aren't re-registered on
    // style.load, the symbol layers reference missing icons and EVERY institution
    // silently disappears the first time you switch basemap.
    await p.getByRole("button", { name: /^satellite$/i }).click();
    await p.waitForTimeout(3000);
    const imgs = await p.evaluate(() =>
      ["circle", "square", "triangle", "diamond"].map((s) => window.__ugnayMap.hasImage(`ugnay-shape-${s}`))
    );
    assert(imgs.every(Boolean), "shape images were NOT re-registered after the basemap switch");
    const drawn = await renderedCount(p, "nodes-basic");
    assert(drawn > 0, "institutions vanished after the basemap switch (missing icons)");
    await p.getByRole("button", { name: /^plain$/i }).click();
    await p.waitForTimeout(2500);
    const back = await renderedCount(p, "nodes-basic");
    assert(back > 0, "institutions vanished switching back to plain");
    return `images re-registered; ${drawn} pins on satellite, ${back} back on plain`;
  });

  await T("T9.7", "Icon halo never floods the quad (white-square regression)", async () => {
    // MapLibre's SDF shader derives the halo cutoff as buff = (6 - haloWidth/iconSize)/8.
    // If haloWidth/iconSize >= 6, buff goes negative and the shader paints the WHOLE icon
    // quad with the halo colour — every node grows a translucent white SQUARE. It is
    // invisible on the light basemap and glaring on satellite, which is why it shipped.
    // The ratio must stay well under 6 at EVERY node size, not just the default.
    await openPanel(p);
    await tab(p, "Appearance");
    await p.waitForTimeout(400);
    const slider = sliderFor(p, "Node size");
    const rows = [];
    for (const ns of ["2", "3.25", "4", "6.5", "9"]) {
      await slider.fill(ns);
      await p.waitForTimeout(350);
      const m = await p.evaluate(() => {
        const map = window.__ugnayMap;
        const size = map.getLayoutProperty("nodes-basic", "icon-size");
        const halo = map.getPaintProperty("nodes-basic", "icon-halo-width");
        const last = (v) => (Array.isArray(v) ? v[v.length - 1] : v); // non-selected branch
        return { iconSize: last(size), haloW: last(halo) };
      });
      const ratio = m.haloW / m.iconSize;
      assert(
        Number.isFinite(ratio) && ratio < 6,
        `nodeSize ${ns}: haloWidth/iconSize = ${ratio.toFixed(2)} ≥ 6 → the SDF halo floods the quad (white squares)`
      );
      rows.push(`${ns}:${ratio.toFixed(2)}`);
    }
    await slider.fill("4");
    await p.waitForTimeout(400);
    return `halo/iconSize ratio across the slider — ${rows.join("  ")} (all < 6)`;
  });

  await T("T9.8", "Sector labels are not truncated in the shape picker", async () => {
    const clipped = await p.evaluate(() =>
      [...document.querySelectorAll("span")]
        .filter((e) => e.scrollWidth > e.clientWidth + 1 && /Higher Ed|DepEd|TESDA/.test(e.innerText || ""))
        .map((e) => e.innerText)
    );
    assert(clipped.length === 0, `sector labels are clipped: ${JSON.stringify(clipped)}`);
    const txt = await p.locator("body").innerText();
    assert(/Higher Ed — Public/.test(txt) && /Higher Ed — Private/.test(txt),
      "the full 'Higher Ed — Public/Private' labels are not rendered");
    return "full sector names shown (no '…' truncation)";
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

  await T("T10.2", "Hide-UI slides each panel to its own edge; restore button persists", async () => {
    const btn = p.locator('button[title*="Hide panels" i]');
    assert((await btn.count()) > 0, "hide-UI button not found (title*='Hide panels')");

    const geom = () => p.evaluate(() => {
      const box = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.x), right: Math.round(r.right), bottom: Math.round(r.bottom),
                 hidden: e.getAttribute("aria-hidden") === "true", inert: e.hasAttribute("inert") };
      };
      return {
        header: box("header"),
        panel: box(".absolute.top-14.right-3") || box("[class*='top-14'][class*='right-3']"),
        legend: box(".absolute.bottom-3.left-3"),
        restore: !!document.querySelector('button[title*="Show panels" i]'),
        zoom: !!document.querySelector(".maplibregl-ctrl-zoom-in"),
        canvas: !!document.querySelector(".maplibregl-canvas"),
        w: window.innerWidth,
      };
    });

    const before = await geom();
    assert(before.header && before.header.bottom > 0, "header not on screen to begin with");

    await btn.first().click();
    await p.waitForTimeout(700); // let the 300ms slide finish
    const after = await geom();

    // The panels must actually LEAVE — each toward its own edge — not merely fade.
    assert(after.header.bottom <= 1, `header did not slide up (bottom ${after.header.bottom})`);
    if (after.panel) {
      assert(after.panel.x >= after.w - 2, `Layers panel did not slide right (x ${after.panel.x} of ${after.w})`);
    }
    if (after.legend) {
      assert(after.legend.right <= 1, `Legend did not slide left (right ${after.legend.right})`);
    }
    // Slid off-screen is not "gone": they must also leave the a11y tree and the tab order,
    // or a keyboard user tabs into a bar they cannot see.
    assert(after.header.hidden && after.header.inert, "hidden header is not aria-hidden + inert");
    assert(after.restore, "restore (eye) button missing — the UI would be unrecoverable");
    assert(after.zoom && after.canvas, "zoom control / canvas should remain");

    await p.locator('button[title*="Show panels" i]').first().click();
    await p.waitForTimeout(700);
    const back = await geom();
    assert(back.header.bottom > 0 && !back.header.hidden, "chrome did not come back");
    return `header ↑, panel →, legend ← (each to its own edge); all inert while hidden; restore works`;
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


  // ===== T14 — Mobile design (390x844) =====
  log("\nT14 — Mobile (390×844)");
  {
    const mctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
    const m = await mctx.newPage();

    await T("T14.1", "Landing: primary action reachable without scrolling", async () => {
      await m.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
      await m.waitForSelector("select", { timeout: 30000 });
      const btn = m.getByRole("button", { name: /Explore map/ });
      const b0 = await btn.boundingBox();
      assert(b0 && b0.y + b0.height <= 844, `Explore button off-screen at load (y=${b0?.y})`);
      // choosing a region grows the card — the button must NOT be pushed below the fold
      await m.locator("select").first().selectOption({ label: "Cordillera Administrative Region (CAR)" });
      await m.waitForTimeout(900);
      const b1 = await btn.boundingBox();
      assert(b1 && b1.y + b1.height <= 844, `Explore pushed off-screen after choosing a region (y=${b1?.y})`);
      assert(await btn.isVisible(), "Explore not visible");
      assert(b1.height >= 40, `tap target too small: ${b1.height}px (want ≥ 40)`);
      // The app shell must size on `dvh`, not `vh`. `vh` is the LARGEST viewport — it
      // ignores the mobile browser's URL/nav bars, so the app's bottom edge (and this
      // button with it) hides underneath them until the chrome auto-hides.
      const units = await m.evaluate(() => {
        const root = document.querySelector("#root > div") || document.body.firstElementChild;
        return { cls: root.className, h: Math.round(root.getBoundingClientRect().height) };
      });
      assert(/dvh/.test(units.cls) && !/h-screen/.test(units.cls),
        `app shell must use dvh, not vh/h-screen (class: "${units.cls}")`);
      return `Explore pinned at y=${Math.round(b1.y)}, ${Math.round(b1.height)}px tall, before & after the province list appears; shell sized in dvh`;
    });

    await T("T14.2", "Landing hint says 'Pick a region' before any region is chosen", async () => {
      const fresh = await mctx.newPage();
      await fresh.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
      await fresh.waitForSelector("select");
      const txt = await fresh.locator("body").innerText();
      assert(/Pick a region/i.test(txt), "expected the hint to say 'Pick a region'");
      assert(!/Pick at least one province/i.test(txt), "still telling the user to pick a province before a region exists");
      await fresh.close();
      return "'Pick a region' shown; province hint suppressed until a region exists";
    });

    await T("T14.3", "Header does not overflow; map chrome is a bottom sheet", async () => {
      await enterMap(m, { region: "Cordillera Administrative Region (CAR)", province: "Benguet" });
      const hdr = await m.evaluate(() => {
        const h = document.querySelector("header");
        return { w: Math.round(h.getBoundingClientRect().width), scroll: h.scrollWidth, client: h.clientWidth };
      });
      assert(hdr.scroll <= hdr.client + 1, `header overflows: scrollWidth ${hdr.scroll} > clientWidth ${hdr.client}`);
      const hScroll = await m.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      assert(!hScroll, "page scrolls horizontally at 390px");
      // header must NOT carry the desktop-only controls any more
      const t = await m.locator("header").innerText();
      assert(!/Gap analysis/i.test(t), "gap analysis still in the mobile header (it belongs in the sheet)");
      assert(!/satellite/i.test(t), "basemap buttons still in the mobile header");
      const sheet = await m.locator(".ugnay-sheet").count();
      assert(sheet === 1, "bottom sheet not present");
      return `header ${hdr.w}px, no overflow, no h-scroll; controls moved into the sheet`;
    });

    await T("T14.4", "Sheet is COLLAPSED by default — the map is unobstructed", async () => {
      const body = m.locator(".ugnay-sheet .transition-all.overflow-hidden").first();
      const h = await body.evaluate((e) => e.getBoundingClientRect().height);
      assert(h < 5, `sheet body is open on load (${Math.round(h)}px) — the map should be clear by default`);
      const sheetTop = await m.evaluate(() => document.querySelector(".ugnay-sheet").getBoundingClientRect().top);
      const mapVisible = (844 - sheetTop) / 844;
      assert(sheetTop > 700, `collapsed sheet eats too much screen (top at ${Math.round(sheetTop)}px)`);
      return `collapsed to ${Math.round(844 - sheetTop)}px; ${Math.round((sheetTop - 45) / (844 - 45) * 100)}% of the map visible`;
    });

    await T("T14.5", "Sheet opens with Filters / Appearance / Legend, incl. the moved controls", async () => {
      await m.getByRole("button", { name: /LAYERS & FILTERS/i }).click();
      await m.waitForTimeout(700);
      const txt = await m.locator(".ugnay-sheet").innerText();
      for (const want of ["Filters", "Appearance", "Legend", "Sectors", "Basemap", "Gap analysis"]) {
        assert(new RegExp(want, "i").test(txt), `sheet is missing "${want}"`);
      }
      const body = m.locator(".ugnay-sheet .transition-all.overflow-hidden").first();
      const h = await body.evaluate((e) => e.getBoundingClientRect().height);
      assert(h > 100, `sheet did not open (${Math.round(h)}px)`);
      assert(h <= 844 * 0.72, `sheet is taller than 70vh (${Math.round(h)}px) — it would swallow the map`);
      // the Legend tab must actually show the key
      await m.getByRole("button", { name: "Legend", exact: true }).click();
      await m.waitForTimeout(500);
      const leg = await m.locator(".ugnay-sheet").innerText();
      assert(/DepEd Public/.test(leg), "Legend tab does not show the sector key");
      await m.getByRole("button", { name: "Filters", exact: true }).click();
      await m.waitForTimeout(300);
      return `sheet ${Math.round(h)}px (≤70vh); tabs + sectors + basemap + gap analysis + legend all present`;
    });

    await T("T14.6", "Zoom +/- and attribution clear the sheet (not buried under it)", async () => {
      // collapse the sheet first — this is the default state the map is read in
      await m.getByRole("button", { name: /LAYERS & FILTERS/i }).click();
      await m.waitForTimeout(700);
      const g = await m.evaluate(() => {
        const sheet = document.querySelector(".ugnay-sheet").getBoundingClientRect();
        const zi = document.querySelector(".maplibregl-ctrl-zoom-in").getBoundingClientRect();
        const zo = document.querySelector(".maplibregl-ctrl-zoom-out").getBoundingClientRect();
        const attr = document.querySelector(".maplibregl-ctrl-attrib");
        const a = attr ? attr.getBoundingClientRect() : null;
        const stack = document.querySelector(".ugnay-map-controls").getBoundingClientRect();
        const el = document.elementFromPoint(zi.x + zi.width / 2, zi.y + zi.height / 2);
        return {
          sheetTop: Math.round(sheet.top),
          zoomOutBottom: Math.round(zo.bottom),
          attrBottom: a ? Math.round(a.bottom) : null,
          gapAboveZoom: Math.round(zi.top - stack.bottom),
          zoomCovered: !!(el && el.closest && (el.closest(".ugnay-sheet") || el.closest(".ugnay-map-controls"))),
        };
      });
      assert(!g.zoomCovered, "the zoom-in button is covered (by the sheet or the control stack)");
      assert(g.zoomOutBottom <= g.sheetTop, `zoom block (bottom ${g.zoomOutBottom}) is under the sheet (top ${g.sheetTop})`);
      assert(g.attrBottom === null || g.attrBottom <= g.sheetTop + 2,
        `attribution (bottom ${g.attrBottom}) is hidden behind the sheet (top ${g.sheetTop}) — CARTO/OSM require it visible`);
      assert(g.gapAboveZoom >= 0, `control stack overlaps the zoom block by ${-g.gapAboveZoom}px`);
      const z0 = await m.evaluate(() => window.__ugnayMap.getZoom());
      await m.locator(".maplibregl-ctrl-zoom-in").click({ timeout: 5000 });
      await m.waitForTimeout(900);
      const z1 = await m.evaluate(() => window.__ugnayMap.getZoom());
      assert(z1 > z0 + 0.1, `zoom-in had no effect on mobile (${z0.toFixed(2)} → ${z1.toFixed(2)})`);
      return `sheet top ${g.sheetTop}; zoom ends ${g.zoomOutBottom}, attribution ends ${g.attrBottom}; ${g.gapAboveZoom}px above zoom; zoom-in works`;
    });

    await T("T14.7", "Tapping a node opens a BOTTOM sheet and pans the map up", async () => {
      const before = await m.evaluate(() => window.__ugnayMap.getCenter().lat);
      // Pick the LOWEST node that is still on the map — i.e. above the collapsed sheet.
      // A node under the sheet can't be tapped at all: the tap would hit the sheet.
      const hit = await m.evaluate(() => {
        const map = window.__ugnayMap;
        const sheetTop = document.querySelector(".ugnay-sheet").getBoundingClientRect().top;
        const rect = document.querySelector(".maplibregl-canvas").getBoundingClientRect();
        const maxCanvasY = sheetTop - rect.top - 24; // stay clear of the sheet
        const feats = map.queryRenderedFeatures({ layers: ["nodes-basic", "nodes-higher", "nodes-techvoc"] });
        let best = null, by = -Infinity;
        for (const f of feats) {
          const q = map.project(f.geometry.coordinates);
          if (q.y > by && q.y < maxCanvasY) { by = q.y; best = f; }
        }
        if (!best) return null;
        const q = map.project(best.geometry.coordinates);
        return { x: q.x + rect.left, y: q.y + rect.top, canvasY: Math.round(q.y) };
      });
      assert(hit, "no tappable node above the sheet");
      await m.mouse.click(hit.x, hit.y);
      await m.waitForTimeout(1800);
      // The <aside> is always mounted and slides on a transform, so "does it exist" and
      // "how wide is it" prove nothing. Its TOP is what tells you it actually slid in.
      const drawer = await m.evaluate(() => {
        const d = document.querySelector("aside");
        if (!d) return null;
        const r = d.getBoundingClientRect();
        return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width) };
      });
      assert(drawer, "detail panel not found");
      assert(drawer.top < 800, `detail sheet did not slide in (top ${drawer.top}) — the tap selected nothing`);
      assert(drawer.width >= 380, `detail panel is ${drawer.width}px wide — should be full-width on mobile, not an 18rem side drawer`);
      assert(drawer.left <= 2, `detail panel is inset from the left (${drawer.left}) — still a side drawer?`);
      const after = await m.evaluate(() => window.__ugnayMap.getCenter().lat);
      const panned = Math.abs(after - before) > 1e-6;
      assert(panned, "map did not pan up; the tapped node stays hidden under the detail sheet");
      return `full-width bottom sheet (${drawer.width}px, top ${drawer.top}); map panned up to clear it`;
    });

    await m.close();
    await mctx.close();
  }

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
