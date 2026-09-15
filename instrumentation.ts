/**
 * Next.js instrumentation hook — runs once per serverless instance before
 * request handlers. It installs the minimal geometry globals expected by
 * pdfjs/pdf-parse text extraction and registers process-level error capture.
 */

function installPdfGeometryGlobals() {
  const globalScope = globalThis as typeof globalThis & {
    DOMMatrix?: typeof DOMMatrix;
    ImageData?: typeof ImageData;
    Path2D?: typeof Path2D;
  };

  if (typeof globalScope.DOMMatrix === "undefined") {
    class NodeDOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      m11 = 1; m12 = 0; m13 = 0; m14 = 0;
      m21 = 0; m22 = 1; m23 = 0; m24 = 0;
      m31 = 0; m32 = 0; m33 = 1; m34 = 0;
      m41 = 0; m42 = 0; m43 = 0; m44 = 1;
      is2D = true;

      constructor(init?: string | number[]) {
        if (Array.isArray(init) && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init.slice(0, 6).map(Number);
          this.sync();
        }
      }

      private sync() {
        this.m11 = this.a; this.m12 = this.b;
        this.m21 = this.c; this.m22 = this.d;
        this.m41 = this.e; this.m42 = this.f;
      }

      multiply(other: NodeDOMMatrix) {
        return new NodeDOMMatrix([
          this.a * other.a + this.c * other.b,
          this.b * other.a + this.d * other.b,
          this.a * other.c + this.c * other.d,
          this.b * other.c + this.d * other.d,
          this.a * other.e + this.c * other.f + this.e,
          this.b * other.e + this.d * other.f + this.f,
        ]);
      }

      multiplySelf(other: NodeDOMMatrix) {
        const result = this.multiply(other);
        Object.assign(this, result);
        this.sync();
        return this;
      }

      preMultiplySelf(other: NodeDOMMatrix) {
        const result = other.multiply(this);
        Object.assign(this, result);
        this.sync();
        return this;
      }

      translate(tx = 0, ty = 0) { return this.multiply(new NodeDOMMatrix([1, 0, 0, 1, tx, ty])); }
      translateSelf(tx = 0, ty = 0) { return this.multiplySelf(new NodeDOMMatrix([1, 0, 0, 1, tx, ty])); }
      scale(scaleX = 1, scaleY = scaleX) { return this.multiply(new NodeDOMMatrix([scaleX, 0, 0, scaleY, 0, 0])); }
      scaleSelf(scaleX = 1, scaleY = scaleX) { return this.multiplySelf(new NodeDOMMatrix([scaleX, 0, 0, scaleY, 0, 0])); }
      rotate(angle = 0) {
        const radians = angle * Math.PI / 180;
        return this.multiply(new NodeDOMMatrix([Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0]));
      }
      rotateSelf(angle = 0) {
        const result = this.rotate(angle);
        Object.assign(this, result);
        this.sync();
        return this;
      }
      inverse() {
        const determinant = this.a * this.d - this.b * this.c;
        if (!determinant) return new NodeDOMMatrix();
        return new NodeDOMMatrix([
          this.d / determinant,
          -this.b / determinant,
          -this.c / determinant,
          this.a / determinant,
          (this.c * this.f - this.d * this.e) / determinant,
          (this.b * this.e - this.a * this.f) / determinant,
        ]);
      }
      invertSelf() {
        const result = this.inverse();
        Object.assign(this, result);
        this.sync();
        return this;
      }
      transformPoint(point: { x?: number; y?: number; z?: number; w?: number } = {}) {
        const x = point.x ?? 0;
        const y = point.y ?? 0;
        return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: point.z ?? 0, w: point.w ?? 1 };
      }
      toFloat32Array() { return new Float32Array([this.a, this.b, 0, 0, this.c, this.d, 0, 0, 0, 0, 1, 0, this.e, this.f, 0, 1]); }
      toFloat64Array() { return new Float64Array(this.toFloat32Array()); }
      toString() { return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`; }
    }
    globalScope.DOMMatrix = NodeDOMMatrix as unknown as typeof DOMMatrix;
  }

  if (typeof globalScope.ImageData === "undefined") {
    class NodeImageData {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      colorSpace = "srgb" as const;
      constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, maybeHeight?: number) {
        if (typeof dataOrWidth === "number") {
          this.width = dataOrWidth;
          this.height = widthOrHeight;
          this.data = new Uint8ClampedArray(this.width * this.height * 4);
        } else {
          this.data = dataOrWidth;
          this.width = widthOrHeight;
          this.height = maybeHeight ?? Math.floor(dataOrWidth.length / Math.max(1, this.width * 4));
        }
      }
    }
    globalScope.ImageData = NodeImageData as unknown as typeof ImageData;
  }

  if (typeof globalScope.Path2D === "undefined") {
    class NodePath2D {
      addPath() {}
      closePath() {}
      moveTo() {}
      lineTo() {}
      bezierCurveTo() {}
      quadraticCurveTo() {}
      arc() {}
      arcTo() {}
      ellipse() {}
      rect() {}
      roundRect() {}
    }
    globalScope.Path2D = NodePath2D as unknown as typeof Path2D;
  }
}

export async function register() {
  if (typeof process === "undefined" || !process.on) return;
  installPdfGeometryGlobals();

  const { reportError } = await import("./lib/observability");

  process.on("unhandledRejection", (reason: unknown) => {
    void reportError(reason, { tags: ["unhandled-rejection"], source: "instrumentation.ts" });
  });

  process.on("uncaughtException", (error: Error) => {
    void reportError(error, { tags: ["uncaught-exception"], source: "instrumentation.ts" });
    setImmediate(() => { throw error; });
  });
}
