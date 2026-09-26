import mapboxgl from 'mapbox-gl';

// A Mapbox custom WebGL layer: rings pulse out from the report on the 3D map, in the
// category's marking colour, sized in real metres so they scale with the map.

export function pulseLayer(lngLat: [number, number], hex: string, radiusM = 60): mapboxgl.CustomLayerInterface {
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let aPos = -1;
  let uMatrix: WebGLUniformLocation | null = null;
  let uTime: WebGLUniformLocation | null = null;
  let uColor: WebGLUniformLocation | null = null;
  let map: mapboxgl.Map | null = null;
  const c = parseInt(hex.slice(1), 16);
  const rgb = [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

  return {
    id: 'report-pulse',
    type: 'custom',
    renderingMode: '3d',
    onAdd(m, gl) {
      map = m;
      const vs2 = `
        uniform mat4 uMatrix;
        attribute vec4 aPos;
        varying vec2 vLocal;
        void main() { vLocal = aPos.zw; gl_Position = uMatrix * vec4(aPos.xy, 0.0, 1.0); }`;
      const fs = `
        precision mediump float;
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vLocal;
        void main() {
          float d = length(vLocal);
          float a = 0.0;
          for (int i = 0; i < 3; i++) {
            float ph = fract(uTime * 0.45 + float(i) / 3.0);
            float ring = smoothstep(0.035, 0.0, abs(d - ph)) * (1.0 - ph);
            a += ring;
          }
          a += smoothstep(0.16, 0.0, d) * 0.5;
          a *= smoothstep(1.0, 0.9, d);
          gl_FragColor = vec4(uColor * a, a);
        }`;
      const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
      program = gl.createProgram()!;
      gl.attachShader(program, sh(gl.VERTEX_SHADER, vs2));
      gl.attachShader(program, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(program);
      aPos = gl.getAttribLocation(program, 'aPos');
      uMatrix = gl.getUniformLocation(program, 'uMatrix');
      uTime = gl.getUniformLocation(program, 'uTime');
      uColor = gl.getUniformLocation(program, 'uColor');

      const mc = mapboxgl.MercatorCoordinate.fromLngLat(lngLat, 0);
      const r = radiusM * mc.meterInMercatorCoordinateUnits();
      const quad = new Float32Array([
        mc.x - r, mc.y - r, -1, -1,
        mc.x + r, mc.y - r, 1, -1,
        mc.x - r, mc.y + r, -1, 1,
        mc.x + r, mc.y + r, 1, 1,
      ]);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    },
    render(gl, matrix) {
      if (!program || !buffer) return;
      gl.useProgram(program);
      gl.uniformMatrix4fv(uMatrix, false, matrix as unknown as Float32Array);
      gl.uniform1f(uTime, performance.now() / 1000);
      gl.uniform3fv(uColor, rgb);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 4, gl.FLOAT, false, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      map?.triggerRepaint();
    },
  };
}
