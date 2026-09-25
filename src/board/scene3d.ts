// The three.js side of the 3D board: builds the extruded map once, then
// applies game state (owners, armies, selection, arrows) on every update.
// Kept free of React so the component only forwards props.

import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { ALL_TERRITORY_IDS, CONTINENTS, TERRITORIES, type ContinentId, type TerritoryId } from "../game/mapData.ts";
import type { PlayerState, TerritoryState } from "../game/types.ts";
import { CONTINENT_TINTS, textOn, withAlpha } from "./colors.ts";
import { BOARD } from "./geometry.ts";
import type { Insets } from "./usePanZoom.ts";

export interface SceneArrow {
  from: TerritoryId;
  to: TerritoryId;
  tone: "attack" | "move";
}

export interface SceneState {
  territories?: Record<TerritoryId, TerritoryState>;
  players?: PlayerState[];
  selected?: TerritoryId | null;
  targets?: ReadonlySet<TerritoryId>;
  focusable?: ReadonlySet<TerritoryId> | null;
  draft?: Partial<Record<TerritoryId, number>>;
  arrow?: SceneArrow | null;
  flash?: { id: TerritoryId; key: number } | null;
  holders: Record<ContinentId, PlayerState | null>;
  clickable: boolean;
}

export interface SceneCallbacks {
  onClick: (id: TerritoryId, modifiers: { shift: boolean; alt: boolean }) => void;
  onContextMenu: (id: TerritoryId) => void;
  onHover: (hover: { id: TerritoryId; x: number; y: number } | null) => void;
}

// ---------- board geometry, parsed once ----------

type Ring = [number, number][];
interface Poly {
  outer: Ring;
  holes: Ring[];
}

const W = BOARD.width;
const H = BOARD.height;
const X = (x: number) => x - W / 2;
const Z = (y: number) => y - H / 2;

function parsePath(d: string): Ring[] {
  return d
    .split("M")
    .filter(Boolean)
    .map((sub) =>
      sub
        .replace("Z", "")
        .split("L")
        .map((pt) => pt.trim().split(" ").map(Number) as [number, number]),
    );
}

function ringArea(r: Ring): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % r.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

function inside([px, py]: [number, number], ring: Ring): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Splits a path into outer rings and the holes inside them (holes wind the other way). */
function toPolys(d: string): Poly[] {
  const rings = parsePath(d);
  const areas = rings.map(ringArea);
  const outerSign = Math.sign(areas.reduce((best, a) => (Math.abs(a) > Math.abs(best) ? a : best), 0));
  const polys: Poly[] = rings.filter((_, i) => Math.sign(areas[i]) === outerSign).map((outer) => ({ outer, holes: [] }));
  rings.forEach((r, i) => {
    if (Math.sign(areas[i]) === outerSign) return;
    polys.find((p) => inside(r[0], p.outer))?.holes.push(r);
  });
  return polys;
}

// ---------- tunables ----------

const DEPTH = 9;
const TOP = DEPTH + 1;
const TILT = 0.62; // camera angle from straight down, radians
const FOV = 38;
const BADGE_Y = TOP + 9;
const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const DARK = new THREE.Color("#070b14");
const GOLD = new THREE.Color("#f2cf78");
const OUTLINE = new THREE.Color("#05080f");
const WHITE = new THREE.Color("#ffffff");

interface TerritoryView {
  id: TerritoryId;
  group: THREE.Group;
  top: THREE.MeshStandardMaterial;
  side: THREE.MeshStandardMaterial;
  outline: THREE.LineBasicMaterial;
  coin: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
  badge: THREE.Sprite;
  badgeCanvas: HTMLCanvasElement;
  badgeTexture: THREE.CanvasTexture;
  badgeKey: string;
  /** Badge width in world units at the reference zoom. */
  badgeSize: number;
  lift: number;
  label: [number, number];
}

interface Flight {
  t: number;
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPos: THREE.Vector3;
  toTarget: THREE.Vector3;
}

export class BoardScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 5, 8000);
  private controls: MapControls;
  private views = new Map<TerritoryId, TerritoryView>();
  private pickables: THREE.Mesh[] = [];
  private continentSprites = new Map<ContinentId, { sprite: THREE.Sprite; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; key: string }>();
  private laneMaterial!: THREE.LineDashedMaterial;
  private arrowGroup = new THREE.Group();
  private arrowKey = "";
  private flashes: { mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; age: number }[] = [];
  private lastFlashKey: number | null = null;
  private state: SceneState | null = null;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private size = { w: 1, h: 1 };
  private fitted = false;
  private flight: Flight | null = null;
  private frame = 0;
  private clock = new THREE.Clock();
  private pointer: { x: number; y: number; inside: boolean } = { x: 0, y: 0, inside: false };
  private pointerDirty = false;
  private down: { x: number; y: number; button: number } | null = null;
  private hovered: TerritoryId | null = null;
  private raycaster = new THREE.Raycaster();
  private resizeObserver: ResizeObserver;
  private disposed = false;
  private coinGeometry = new THREE.CylinderGeometry(7.5, 8.5, 3.5, 28);

  private container: HTMLElement;
  private callbacks: SceneCallbacks;

  constructor(container: HTMLElement, callbacks: SceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    container.appendChild(canvas);

    this.scene.background = DARK;
    this.scene.fog = new THREE.Fog(DARK, 1700, 3600);

    this.controls = new MapControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 120;
    this.controls.maxDistance = 2200;
    this.controls.maxPolarAngle = 1.2;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener("start", () => (this.flight = null));
    this.controls.addEventListener("change", () => this.clampTarget());

    this.buildLights();
    this.buildOcean();
    this.buildTerritories();
    this.buildSeaLanes();
    this.buildContinentLabels();
    this.scene.add(this.arrowGroup);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("contextmenu", this.onContextMenu);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    // Canvas text is drawn with the page fonts; redraw once they've loaded.
    void document.fonts?.ready.then(() => {
      if (this.disposed) return;
      for (const v of this.views.values()) v.badgeKey = "";
      for (const c of this.continentSprites.values()) c.key = "";
      if (this.state) this.update(this.state);
    });

    this.frame = requestAnimationFrame(this.tick);
  }

  // ---------- construction ----------

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight("#a4b8dc", "#0a0f1c", 0.95));
    const sun = new THREE.DirectionalLight("#ffe6bf", 2.3);
    sun.position.set(-520, 950, 420);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -W * 0.6, right: W * 0.6, top: H * 0.7, bottom: -H * 0.7, near: 100, far: 2800 });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight("#3d6bff", 0.45);
    rim.position.set(600, 300, -700);
    this.scene.add(rim);
  }

  private buildOcean() {
    const c = document.createElement("canvas");
    c.width = 2048;
    c.height = 1280;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(1024, 620, 80, 1024, 640, 1250);
    grad.addColorStop(0, "#10233d");
    grad.addColorStop(1, "#050a14");
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "rgba(120,160,220,0.07)";
    g.lineWidth = 2;
    for (let x = 0; x <= c.width; x += 64) g.strokeRect(x, -2, 0, c.height + 4);
    for (let y = 0; y <= c.height; y += 64) g.strokeRect(-2, y, c.width + 4, 0);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 1.8, H * 1.9),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55, metalness: 0.25 }),
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.receiveShadow = true;
    this.scene.add(ocean);
  }

  private buildTerritories() {
    const toVec = (r: Ring) => r.map(([x, y]) => new THREE.Vector2(X(x), -Z(y)));
    for (const id of ALL_TERRITORY_IDS) {
      const geo = BOARD.territories[id];
      const tint = CONTINENT_TINTS[TERRITORIES[id].continent];
      const top = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.7, metalness: 0.08, emissive: new THREE.Color(0) });
      const side = new THREE.MeshStandardMaterial({ color: "#141a26", roughness: 0.85 });
      const outline = new THREE.LineBasicMaterial({ color: OUTLINE, transparent: true, opacity: 0.8 });
      const group = new THREE.Group();

      for (const { outer, holes } of toPolys(geo.path)) {
        const shape = new THREE.Shape(toVec(outer));
        for (const h of holes) shape.holes.push(new THREE.Path(toVec(h)));
        // Small islands skip the bevel: an inset bevel would turn them inside out.
        const big = Math.abs(ringArea(outer)) > 60;
        const geometry = new THREE.ExtrudeGeometry(
          shape,
          big
            ? { depth: DEPTH, bevelEnabled: true, bevelThickness: 1, bevelSize: 0.6, bevelOffset: -0.6, bevelSegments: 2, curveSegments: 1 }
            : { depth: TOP, bevelEnabled: false, curveSegments: 1 },
        );
        const mesh = new THREE.Mesh(geometry, [top, side]);
        mesh.rotation.x = -Math.PI / 2;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.id = id;
        group.add(mesh);
        this.pickables.push(mesh);
        for (const ring of [outer, ...holes]) {
          const points = ring.map(([x, y]) => new THREE.Vector3(X(x), TOP + 0.15, Z(y)));
          group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), outline));
        }
      }

      const [lx, ly] = geo.label;
      const coin = new THREE.Mesh(this.coinGeometry, new THREE.MeshStandardMaterial({ color: "#6b7280", roughness: 0.3, metalness: 0.55 }));
      coin.position.set(X(lx), TOP + 1.75, Z(ly));
      coin.castShadow = true;
      coin.visible = false;
      group.add(coin);

      const badgeCanvas = document.createElement("canvas");
      badgeCanvas.width = 128;
      badgeCanvas.height = 176;
      const badgeTexture = new THREE.CanvasTexture(badgeCanvas);
      badgeTexture.colorSpace = THREE.SRGBColorSpace;
      badgeTexture.anisotropy = 4;
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture, depthTest: false, depthWrite: false }));
      const badgeSize = Math.max(17, Math.min(24, geo.clearance * 1.7));
      badge.center.set(0.5, (176 - 112) / 176); // anchor on the circle, not the canvas
      badge.position.set(X(lx), BADGE_Y, Z(ly));
      badge.renderOrder = 20;
      badge.visible = false;
      group.add(badge);

      this.scene.add(group);
      this.views.set(id, { id, group, top, side, outline, coin, badge, badgeCanvas, badgeTexture, badgeKey: "", badgeSize, lift: 0, label: geo.label });
    }
  }

  private buildSeaLanes() {
    this.laneMaterial = new THREE.LineDashedMaterial({ color: "#d4a84b", dashSize: 6, gapSize: 5, transparent: true, opacity: 0.75 });
    const arc = (a: [number, number], b: [number, number]) => {
      const A = new THREE.Vector3(X(a[0]), TOP, Z(a[1]));
      const B = new THREE.Vector3(X(b[0]), TOP, Z(b[1]));
      const mid = A.clone().lerp(B, 0.5);
      mid.y += Math.min(60, 8 + A.distanceTo(B) * 0.25);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.QuadraticBezierCurve3(A, mid, B).getPoints(40)), this.laneMaterial);
      line.computeLineDistances();
      this.scene.add(line);
    };
    for (const lane of BOARD.seaLanes) {
      const [p0, p1, p2, p3] = lane.points;
      if (lane.wrap) {
        arc(p0, p1);
        arc(p2, p3);
      } else arc(p0, p1);
    }
  }

  private buildContinentLabels() {
    for (const id of Object.keys(CONTINENTS) as ContinentId[]) {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 160;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false }));
      const [x, y] = BOARD.continentLabels[id];
      sprite.position.set(X(x), TOP + 30, Z(y));
      sprite.renderOrder = 15;
      this.scene.add(sprite);
      this.continentSprites.set(id, { sprite, canvas, texture, key: "" });
    }
  }

  // ---------- state ----------

  update(state: SceneState) {
    this.state = state;
    const players = new Map((state.players ?? []).map((p) => [p.id, p]));
    for (const v of this.views.values()) {
      const t = state.territories?.[v.id];
      const owner = t?.owner ? players.get(t.owner) : undefined;
      const tint = CONTINENT_TINTS[TERRITORIES[v.id].continent];
      const base = owner ? new THREE.Color(tint).lerp(new THREE.Color(owner.color), 0.74) : new THREE.Color(tint);
      const isSelected = state.selected === v.id;
      const isTarget = state.targets?.has(v.id) ?? false;
      const dimmed = !!state.focusable && !state.focusable.has(v.id) && !isSelected && !isTarget;
      v.top.color.copy(dimmed ? base.clone().lerp(DARK, 0.6) : base);
      v.side.color.copy(owner ? new THREE.Color("#141a26").lerp(new THREE.Color(owner.color), dimmed ? 0.12 : 0.3) : new THREE.Color("#141a26"));
      v.top.emissive.copy(owner ? new THREE.Color(owner.color) : WHITE);
      v.outline.color.copy(isSelected ? GOLD : isTarget ? WHITE : OUTLINE);
      v.outline.opacity = isSelected || isTarget ? 1 : dimmed ? 0.5 : 0.8;

      v.coin.visible = v.badge.visible = !!t;
      if (t) {
        const color = owner?.color ?? "#6b7280";
        v.coin.material.color.set(color);
        const draft = state.draft?.[v.id] ?? 0;
        const initial = owner ? owner.name.trim().charAt(0).toUpperCase() : "";
        const key = `${t.armies}|${draft}|${color}|${initial}|${isSelected}`;
        if (key !== v.badgeKey) {
          v.badgeKey = key;
          drawBadge(v.badgeCanvas, { armies: t.armies + draft, draft, color, initial, highlight: isSelected });
          v.badgeTexture.needsUpdate = true;
        }
      }
    }

    for (const [id, c] of this.continentSprites) {
      const holder = state.holders[id];
      const key = holder ? `${holder.id}|${holder.color}` : "";
      if (key === c.key && c.key !== "") continue;
      c.key = key || " ";
      drawContinent(c.canvas, CONTINENTS[id].name, CONTINENTS[id].bonusArmies, holder?.color ?? null);
      c.texture.needsUpdate = true;
    }

    const arrowKey = state.arrow ? `${state.arrow.from}>${state.arrow.to}:${state.arrow.tone}` : "";
    if (arrowKey !== this.arrowKey) {
      this.arrowKey = arrowKey;
      this.setArrow(state.arrow ?? null);
    }

    if (state.flash && state.flash.key !== this.lastFlashKey) {
      this.lastFlashKey = state.flash.key;
      this.addFlash(state.flash.id);
    }
    this.renderer.domElement.style.cursor = state.clickable && this.hovered ? "pointer" : "grab";
  }

  private setArrow(arrow: SceneArrow | null) {
    for (const child of [...this.arrowGroup.children]) {
      this.arrowGroup.remove(child);
      disposeObject(child);
    }
    if (!arrow) return;
    const a = this.views.get(arrow.from)!.label;
    const b = this.views.get(arrow.to)!.label;
    const A = new THREE.Vector3(X(a[0]), BADGE_Y - 2, Z(a[1]));
    const B = new THREE.Vector3(X(b[0]), BADGE_Y - 2, Z(b[1]));
    const dir = B.clone().sub(A);
    const len = dir.length();
    if (len < 20) return;
    dir.normalize();
    const start = A.clone().addScaledVector(dir, 11);
    const end = B.clone().addScaledVector(dir, -14);
    const mid = start.clone().lerp(end, 0.5);
    mid.y += Math.min(70, 10 + len * 0.28);
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const color = arrow.tone === "attack" ? "#ff5a5f" : "#f2cf78";
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 1.4, 8), material);
    tube.renderOrder = 18;
    const head = new THREE.Mesh(new THREE.ConeGeometry(4, 10, 16), material);
    head.position.copy(end);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(1).normalize());
    head.renderOrder = 18;
    this.arrowGroup.add(tube, head);
  }

  private addFlash(id: TerritoryId) {
    const [x, y] = this.views.get(id)!.label;
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(9, 12, 48),
      new THREE.MeshBasicMaterial({ color: "#ffd98a", transparent: true, opacity: 1, depthTest: false, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(X(x), TOP + 1.5, Z(y));
    mesh.renderOrder = 19;
    this.scene.add(mesh);
    this.flashes.push({ mesh, age: 0 });
  }

  setInsets(insets: Insets) {
    this.insets = insets;
    this.applyViewOffset();
  }

  setInteractive(on: boolean) {
    this.controls.enabled = on;
  }

  // ---------- camera ----------

  private applyViewOffset() {
    const { w, h } = this.size;
    const { top, right, bottom, left } = this.insets;
    // Shift the projection so the board's centre sits in the middle of the uncovered area.
    this.camera.setViewOffset(w, h, (right - left) / 2, (bottom - top) / 2, w, h);
  }

  /** Camera pose that shows the whole board in the area the floating UI leaves free. */
  private fitPose(): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const { w, h } = this.size;
    const availW = Math.max(120, w - this.insets.left - this.insets.right);
    const availH = Math.max(120, h - this.insets.top - this.insets.bottom);
    const f = Math.tan((FOV * Math.PI) / 360);
    const byWidth = (W * h) / (2 * f * availW);
    const byHeight = (H * Math.cos(TILT) * h) / (2 * f * availH);
    // On portrait screens fit the height and let players pan sideways.
    const distance = (w < h ? byHeight * 1.05 : Math.max(byWidth, byHeight)) * 1.1;
    const target = new THREE.Vector3(0, 0, H * 0.03);
    const pos = target.clone().add(new THREE.Vector3(0, Math.cos(TILT), Math.sin(TILT)).multiplyScalar(distance));
    return { pos, target };
  }

  private flyTo(pos: THREE.Vector3, target: THREE.Vector3) {
    if (reducedMotion) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      return;
    }
    this.flight = { t: 0, fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(), toPos: pos, toTarget: target };
  }

  fit() {
    const { pos, target } = this.fitPose();
    this.flyTo(pos, target);
  }

  zoomBy(factor: number) {
    const target = this.controls.target.clone();
    const offset = this.camera.position.clone().sub(target);
    const distance = THREE.MathUtils.clamp(offset.length() / factor, this.controls.minDistance, this.controls.maxDistance);
    this.flyTo(target.clone().add(offset.setLength(distance)), target);
  }

  private clampTarget() {
    const t = this.controls.target;
    const cx = THREE.MathUtils.clamp(t.x, -W / 2, W / 2);
    const cz = THREE.MathUtils.clamp(t.z, -H / 2, H / 2);
    if (cx !== t.x || cz !== t.z) {
      const dx = cx - t.x;
      const dz = cz - t.z;
      t.set(cx, t.y, cz);
      this.camera.position.x += dx;
      this.camera.position.z += dz;
    }
  }

  private resize() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyViewOffset();
    this.camera.updateProjectionMatrix();
    if (!this.fitted && rect.width > 0) {
      this.fitted = true;
      const { pos, target } = this.fitPose();
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
    }
  }

  // ---------- input ----------

  private onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, button: e.button };
  };

  private onPointerUp = (e: PointerEvent) => {
    const down = this.down;
    this.down = null;
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || !this.state?.clickable) return;
    const id = this.pick(e.clientX, e.clientY);
    if (!id) return;
    if (down.button === 0) this.callbacks.onClick(id, { shift: e.shiftKey, alt: e.altKey });
    else if (down.button === 2) this.callbacks.onContextMenu(id);
  };

  private onPointerMove = (e: PointerEvent) => {
    this.pointer = { x: e.clientX, y: e.clientY, inside: true };
    this.pointerDirty = true;
  };

  private onPointerLeave = () => {
    this.pointer.inside = false;
    this.pointerDirty = true;
  };

  private onContextMenu = (e: MouseEvent) => e.preventDefault();

  private pick(clientX: number, clientY: number): TerritoryId | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    return (hit?.object.userData.id as TerritoryId | undefined) ?? null;
  }

  private updateHover() {
    if (!this.pointerDirty) return;
    this.pointerDirty = false;
    const dragging = this.down !== null;
    const id = this.pointer.inside && !dragging ? this.pick(this.pointer.x, this.pointer.y) : null;
    this.hovered = id;
    this.renderer.domElement.style.cursor = id && this.state?.clickable ? "pointer" : dragging ? "grabbing" : "grab";
    if (!id) return this.callbacks.onHover(null);
    const rect = this.container.getBoundingClientRect();
    this.callbacks.onHover({ id, x: this.pointer.x - rect.left, y: this.pointer.y - rect.top });
  }

  // ---------- frame loop ----------

  private tick = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const time = this.clock.elapsedTime;

    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / 0.7);
      const k = 1 - (1 - f.t) ** 3;
      this.camera.position.lerpVectors(f.fromPos, f.toPos, k);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, k);
      if (f.t === 1) this.flight = null;
    }
    this.controls.update();
    this.updateHover();
    if (!reducedMotion) this.laneMaterial.opacity = 0.6 + 0.2 * Math.sin(time * 1.6);

    // Badges and labels grow as the camera pulls back (but more slowly), so they stay readable.
    const zoom = THREE.MathUtils.clamp((this.camera.position.distanceTo(this.controls.target) / 700) ** 0.7, 0.6, 2.4);
    for (const v of this.views.values()) {
      const size = v.badgeSize * zoom;
      v.badge.scale.set(size, size * (176 / 128), 1);
      v.badge.position.y = BADGE_Y + size * 0.15;
    }
    for (const c of this.continentSprites.values()) c.sprite.scale.set(118 * zoom, 29.5 * zoom, 1);

    const s = this.state;
    const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 4.5);
    for (const v of this.views.values()) {
      const isSelected = s?.selected === v.id;
      const isTarget = s?.targets?.has(v.id) ?? false;
      const isHover = !!s?.clickable && this.hovered === v.id;
      const goal = isSelected ? 10 : isTarget ? 3 + pulse * 2 : isHover ? 3 : 0;
      v.lift += (goal - v.lift) * Math.min(1, dt * 12);
      v.group.position.y = v.lift;
      v.top.emissiveIntensity = isSelected ? 0.45 : isTarget ? 0.12 + pulse * 0.2 : isHover ? 0.14 : 0;
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += dt;
      const k = f.age / 0.9;
      f.mesh.scale.setScalar(1 + k * 2.6);
      f.mesh.material.opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        this.scene.remove(f.mesh);
        disposeObject(f.mesh);
        this.flashes.splice(i, 1);
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.controls.dispose();
    disposeObject(this.scene);
    this.renderer.dispose();
    canvas.remove();
  }
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of materials) {
      (m as THREE.MeshBasicMaterial).map?.dispose();
      m.dispose();
    }
  });
}

// ---------- canvas drawings for sprites ----------

function drawBadge(canvas: HTMLCanvasElement, b: { armies: number; draft: number; color: string; initial: string; highlight: boolean }) {
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const cx = 64;
  const cy = 112;
  const r = 40;
  g.beginPath();
  g.arc(cx, cy, r + 8, 0, Math.PI * 2);
  g.fillStyle = "rgba(3,6,12,0.55)";
  g.fill();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = "#0b1322";
  g.fill();
  g.lineWidth = b.highlight ? 9 : 7;
  g.strokeStyle = b.highlight ? "#f2cf78" : b.color;
  g.stroke();
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const text = String(b.armies);
  g.font = `700 ${text.length > 2 ? 30 : 38}px Inter, system-ui, sans-serif`;
  g.fillText(text, cx, cy + 2);
  if (b.initial) {
    const ix = cx + r * 0.78;
    const iy = cy + r * 0.78;
    g.beginPath();
    g.arc(ix, iy, 17, 0, Math.PI * 2);
    g.fillStyle = b.color;
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = "#0b1322";
    g.stroke();
    g.fillStyle = textOn(b.color);
    g.font = "700 20px Inter, system-ui, sans-serif";
    g.fillText(b.initial, ix, iy + 1);
  }
  if (b.draft > 0) {
    const label = `+${b.draft}`;
    g.font = "700 26px Inter, system-ui, sans-serif";
    const w = Math.max(56, g.measureText(label).width + 26);
    roundRect(g, cx - w / 2, 8, w, 40, 20);
    g.fillStyle = "#d4a84b";
    g.fill();
    g.fillStyle = "#1a1204";
    g.fillText(label, cx, 29);
  }
}

function drawContinent(canvas: HTMLCanvasElement, name: string, bonus: number, holder: string | null) {
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "700 50px Cinzel, Georgia, serif";
  g.letterSpacing = "6px";
  g.lineJoin = "round";
  g.lineWidth = 10;
  g.strokeStyle = "rgba(0,0,0,0.7)";
  const label = name.toUpperCase();
  g.strokeText(label, 320, 52);
  g.fillStyle = "#d4a84b";
  g.fillText(label, 320, 52);
  g.letterSpacing = "0px";
  roundRect(g, 320 - 44, 96, 88, 50, 25);
  g.fillStyle = holder ? withAlpha(holder, 0.3) : "rgba(10,18,34,0.8)";
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = holder ?? "rgba(212,168,75,0.6)";
  g.stroke();
  g.font = "700 30px Inter, system-ui, sans-serif";
  g.fillStyle = "#f5e6c4";
  g.fillText(`+${bonus}`, 320, 122);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
