// Shared 3D chibi character builder — the same look system used for John/Drake/Alex
// in Posted-Demo v16.html, factored out so the multiplayer persona creator can
// preview/customize the identical model instead of a copy that could visually drift
// out of sync. Loaded as a plain script (no bundler) — same convention as the rest of
// the project. Requires window.THREE to already be loaded.
(function () {
  class RoundedBoxGeometry extends THREE.BoxGeometry {
    constructor(width = 1, height = 1, depth = 1, segments = 2, radius = 0.1) {
      segments = segments * 2 + 1;
      radius = Math.min(width / 2, height / 2, depth / 2, radius);
      super(1, 1, 1, segments, segments, segments);
      if (segments === 1) { this.scale(width, height, depth); return; }
      const g2 = this.toNonIndexed();
      this.index = null;
      this.attributes.position = g2.attributes.position;
      this.attributes.normal = g2.attributes.normal;
      this.attributes.uv = g2.attributes.uv;
      const position = new THREE.Vector3(), normal = new THREE.Vector3();
      const box = new THREE.Vector3(width, height, depth).divideScalar(2).subScalar(radius);
      const positions = this.attributes.position.array;
      const normals = this.attributes.normal.array;
      const halfSegmentSize = 0.5 / segments;
      for (let i = 0; i < positions.length; i += 3) {
        position.fromArray(positions, i);
        normal.copy(position);
        normal.x -= Math.sign(normal.x) * halfSegmentSize;
        normal.y -= Math.sign(normal.y) * halfSegmentSize;
        normal.z -= Math.sign(normal.z) * halfSegmentSize;
        normal.normalize();
        positions[i + 0] = box.x * Math.sign(position.x) + normal.x * radius;
        positions[i + 1] = box.y * Math.sign(position.y) + normal.y * radius;
        positions[i + 2] = box.z * Math.sign(position.z) + normal.z * radius;
        normals[i + 0] = normal.x;
        normals[i + 1] = normal.y;
        normals[i + 2] = normal.z;
      }
    }
  }

  const SKIN = 0xF4D6B0;
  const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .95, metalness: 0, ...extra });

  // Kept in lockstep with makeChibi() in Posted-Demo v16.html — same geometry, same
  // proportions — so a customized persona actually looks like the character it'll
  // become once matched into someone's game, not just a similar-ish stand-in.
  function makeChibi({ shirt = 0xF2C6BE, hair = 0x33291F, skirt = null, expression = "smile",
                       brows = false, clip = false, hoodie = false, seated = false, scale = 1 } = {}) {
    const g = new THREE.Group();
    const skin = mat(SKIN), shirtM = mat(shirt), hairM = mat(hair, { roughness: .85 });
    if (!seated) {
      [[-0.09], [0.09]].forEach(([x]) => {
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.14, 4, 10), skin);
        leg.position.set(x, 0.22, 0); g.add(leg);
        const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.07, 0.08, 12), mat(0xFFFFFF));
        sock.position.set(x, 0.1, 0); g.add(sock);
        const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 14), mat(skirt ? 0xF3B8C9 : 0x8A8F98));
        shoe.scale.set(1, 0.55, 1.4); shoe.position.set(x, 0.05, 0.02); shoe.castShadow = true; g.add(shoe);
      });
      if (skirt) {
        const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.4, 0.22, 18), mat(skirt));
        sk.position.y = 0.42; sk.castShadow = true; g.add(sk);
      }
    }
    const baseY = seated ? -0.28 : 0;
    const torso = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.5, 0.34, 3, 0.13), shirtM);
    torso.position.y = 0.72 + baseY; torso.castShadow = true; g.add(torso);
    [[-0.3], [0.3]].forEach(([x]) => {
      const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.26, 4, 10), shirtM);
      a.position.set(x, 0.68 + baseY, 0.02); a.rotation.z = x < 0 ? 0.12 : -0.12; a.castShadow = true; g.add(a);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), skin);
      hand.position.set(x * 1.13, 0.5 + baseY, 0.04); g.add(hand);
    });
    if (hoodie) {
      [[-0.07], [0.07]].forEach(([x]) => {
        const bead = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), mat(0xFFFDF8));
        bead.position.set(x, 0.88 + baseY, 0.18); g.add(bead);
        const str = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.12, 6), mat(0xFFFDF8));
        str.position.set(x, 0.8 + baseY, 0.185); g.add(str);
      });
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 28, 28), skin);
    head.position.y = 1.22 + baseY; head.castShadow = true; g.add(head);
    const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.345, 28, 28), hairM);
    hairBack.position.set(0, 1.27 + baseY, -0.045); hairBack.castShadow = true; g.add(hairBack);
    const fringe = new THREE.Mesh(new THREE.SphereGeometry(0.335, 24, 24, 0, Math.PI * 2, 0, Math.PI * 0.42), hairM);
    fringe.position.set(0, 1.245 + baseY, 0.008); g.add(fringe);
    if (skirt) {
      [[-0.27], [0.27]].forEach(([x]) => {
        const st = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.3, 4, 10), hairM);
        st.position.set(x, 1.02 + baseY, 0.02); st.castShadow = true; g.add(st);
      });
      const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.32, 4, 12), hairM);
      back.position.set(0, 0.98 + baseY, -0.2); back.castShadow = true; g.add(back);
    }
    const face = new THREE.Group(); face.position.y = 1.22 + baseY; g.add(face);
    const eyeM = mat(0x2E2620, { roughness: .4 });
    [[-0.11], [0.11]].forEach(([x]) => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 10), eyeM);
      e.scale.set(1, 1.25, 0.5); e.position.set(x, 0.02, 0.305); face.add(e);
      const hlt = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 6), mat(0xFFFFFF, { roughness: .2 }));
      hlt.position.set(x + 0.012, 0.045, 0.325); face.add(hlt);
    });
    [[-0.18], [0.18]].forEach(([x]) => {
      const b = new THREE.Mesh(new THREE.CircleGeometry(0.05, 14),
        new THREE.MeshBasicMaterial({ color: 0xEFB3A6, transparent: true, opacity: .55 }));
      b.position.set(x, -0.06, 0.292); b.lookAt(x * 3, -0.06, 2); face.add(b);
    });
    if (brows) {
      [[-0.11, 0.28], [0.11, -0.28]].forEach(([x, rz]) => {
        const br = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.028, 0.02, 2, 0.01), mat(hair));
        br.position.set(x, 0.12, 0.3); br.rotation.z = rz; face.add(br);
      });
    }
    const mouthM = mat(0x2E2620, { roughness: .4 });
    const mkArc = (rz, y) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 8, 16, Math.PI * 0.7), mouthM);
      m.rotation.z = rz; m.rotation.x = -0.1; m.position.set(0, y, 0.3); return m;
    };
    const smileM = mkArc(Math.PI + 0.45, -0.08);
    const frownM = mkArc(-0.45, -0.115);
    smileM.visible = (expression === "smile");
    frownM.visible = (expression === "frown");
    face.add(smileM, frownM);
    if (clip) {
      const c = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.03, 0.02, 2, 0.01), mat(0xF3B8C9));
      c.position.set(-0.16, 1.42 + baseY, 0.25); c.rotation.z = 0.5; c.rotation.y = -0.4; g.add(c);
    }
    g.scale.setScalar(scale);
    return g;
  }

  // Converts a persona's stored {hair,top,skirt,hoodie,clip,expression} (hex strings,
  // per appearance.js) into makeChibi()'s param shape (numeric hex, brows always on).
  function appearanceToChibiParams(appearance = {}) {
    const hex = (s) => parseInt(String(s).replace("#", "0x"));
    return {
      shirt: hex(appearance.top || "#f2c6be"),
      hair: hex(appearance.hair || "#33291f"),
      skirt: appearance.skirt ? hex(appearance.skirt) : null,
      hoodie: !!appearance.hoodie,
      clip: !!appearance.clip,
      brows: true,
      expression: appearance.expression === "frown" ? "frown" : "smile"
    };
  }

  // Mounts a small self-contained turntable preview into `container`. Returns an
  // updater to rebuild the character whenever the picked appearance changes, and a
  // dispose() to stop the render loop when the preview is torn down.
  function mountCharacterPreview(container, initialAppearance) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1,100);
    camera.position.set(3.2, 2.6, 3.2);
    camera.lookAt(0, 0.7, 0);

    const hemi = new THREE.HemisphereLight(0xFFF7EA, 0xD8CBB6, 0.9);
    const sun = new THREE.DirectionalLight(0xFFF2DC, 1.3);
    sun.position.set(4, 6, 3);
    scene.add(hemi, sun);

    let current = null;
    function rebuild(appearance) {
      if (current) { scene.remove(current); current = null; }
      current = makeChibi(appearanceToChibiParams(appearance));
      scene.add(current);
    }

    function size() {
      const w = container.clientWidth || 1, h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      const asp = w / h, v = 1.35;
      camera.left = -v * asp; camera.right = v * asp;
      camera.top = v; camera.bottom = -v;
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(size).observe(container);
    size();

    let stopped = false;
    (function animate() {
      if (stopped) return;
      requestAnimationFrame(animate);
      if (current) current.rotation.y += 0.012;
      renderer.render(scene, camera);
    })();

    rebuild(initialAppearance);
    return {
      update: rebuild,
      dispose() { stopped = true; renderer.dispose(); }
    };
  }

  window.Character3D = { makeChibi, appearanceToChibiParams, mountCharacterPreview };
})();
