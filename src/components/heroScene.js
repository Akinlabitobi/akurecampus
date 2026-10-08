import * as THREE from "three";
import { state } from "../lib/state.js";

export function initHeroScene() {
  const canvas = document.querySelector("[data-hero-3d]");
  if (!canvas) return;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
  renderer.setClearColor(0x06152a, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x08172b, 0.055);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 90);
  camera.position.set(0, 5.2, 16);
  camera.lookAt(0, 1.5, 0);

  const group = new THREE.Group();
  scene.add(group);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 34),
    new THREE.MeshStandardMaterial({ color: 0x111f36, roughness: 0.78, metalness: 0.08 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -2;
  group.add(floor);

  const stage = new THREE.Mesh(
    new THREE.BoxGeometry(15, 0.7, 5.2),
    new THREE.MeshStandardMaterial({ color: 0x0b2445, roughness: 0.58, metalness: 0.18 })
  );
  stage.position.set(0, 0.35, -8.6);
  group.add(stage);

  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(17, 8.5, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x071e3d, roughness: 0.7 })
  );
  backWall.position.set(0, 4.3, -11.2);
  group.add(backWall);

  const crossMaterial = new THREE.MeshStandardMaterial({
    color: 0xd71920,
    emissive: 0xd71920,
    emissiveIntensity: 1.6,
    roughness: 0.25
  });
  const crossVertical = new THREE.Mesh(new THREE.BoxGeometry(0.38, 4.2, 0.22), crossMaterial);
  const crossHorizontal = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.35, 0.22), crossMaterial);
  crossVertical.position.set(0, 4.5, -10.9);
  crossHorizontal.position.set(0, 5.15, -10.85);
  group.add(crossVertical, crossHorizontal);

  const seatMaterial = new THREE.MeshStandardMaterial({ color: 0x132b4a, roughness: 0.68, metalness: 0.08 });
  const seatGeometry = new THREE.BoxGeometry(0.92, 0.42, 0.82);
  for (let row = 0; row < 7; row += 1) {
    const z = 4.8 - row * 1.55;
    const width = 4 + row;
    for (let col = -width; col <= width; col += 1) {
      if (Math.abs(col) < 1 && row > 1) continue;
      const seat = new THREE.Mesh(seatGeometry, seatMaterial);
      seat.position.set(col * 1.08, 0.45, z);
      seat.rotation.y = col * -0.018;
      group.add(seat);
    }
  }

  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  [-4.8, 0, 4.8].forEach((x, index) => {
    const beam = new THREE.Mesh(new THREE.ConeGeometry(1.1, 11, 32, 1, true), beamMaterial.clone());
    beam.position.set(x, 6.2, -5.7);
    beam.rotation.x = Math.PI;
    beam.rotation.z = (index - 1) * 0.14;
    group.add(beam);
  });

  const ambient = new THREE.AmbientLight(0x8fb5ff, 0.55);
  const key = new THREE.PointLight(0xffffff, 22, 34);
  key.position.set(-4, 7, 4);
  const red = new THREE.PointLight(0xd71920, 24, 26);
  red.position.set(0, 4.8, -9.8);
  scene.add(ambient, key, red);

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  let frame = 0;
  const animate = () => {
    frame = requestAnimationFrame(animate);
    const t = performance.now() * 0.001;
    group.rotation.y = Math.sin(t * 0.28) * 0.055;
    group.position.y = Math.sin(t * 0.45) * 0.08;
    camera.position.x = Math.sin(t * 0.18) * 0.8;
    camera.lookAt(0, 2.1, -2.5);
    renderer.render(scene, camera);
  };

  resize();
  animate();
  window.addEventListener("resize", resize);

  state.heroSceneCleanup = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    scene.traverse(object => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
      }
    });
    renderer.dispose();
  };
}
