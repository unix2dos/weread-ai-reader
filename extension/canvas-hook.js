(function () {
  'use strict';

  if (window.__WEREAD_AI_CANVAS_HOOK__) return;
  window.__WEREAD_AI_CANVAS_HOOK__ = true;

  const MAX_ITEMS = 12000;
  const EVENT_BATCH = '__wereadAiCanvasTextBatch';
  const EVENT_REQUEST = '__wereadAiRequestCanvasText';
  const canvasTextItems = [];
  let sequence = 0;
  let emitTimer = null;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function capture(kind, ctx, text, x, y) {
    const value = normalizeText(text);
    if (!value) return;

    const canvas = ctx && ctx.canvas;
    const rect = canvas && canvas.getBoundingClientRect
      ? canvas.getBoundingClientRect()
      : { width: 0, height: 0 };
    const transform = ctx && ctx.getTransform ? ctx.getTransform() : null;

    canvasTextItems.push({
      seq: ++sequence,
      time: Date.now(),
      kind,
      text: value,
      x: Number(x) || 0,
      y: Number(y) || 0,
      tx: transform ? Number(transform.e) || 0 : 0,
      ty: transform ? Number(transform.f) || 0 : 0,
      font: ctx && ctx.font ? String(ctx.font) : '',
      canvasWidth: canvas ? Number(canvas.width) || 0 : 0,
      canvasHeight: canvas ? Number(canvas.height) || 0 : 0,
      rectWidth: Math.round(rect.width || 0),
      rectHeight: Math.round(rect.height || 0)
    });

    if (canvasTextItems.length > MAX_ITEMS) {
      canvasTextItems.splice(0, canvasTextItems.length - MAX_ITEMS);
    }
    scheduleEmit();
  }

  function emitBatch() {
    emitTimer = null;
    document.dispatchEvent(new CustomEvent(EVENT_BATCH, {
      detail: JSON.stringify({
        items: canvasTextItems.slice(-MAX_ITEMS),
        total: sequence,
        emittedAt: new Date().toISOString()
      })
    }));
  }

  function scheduleEmit() {
    if (emitTimer) return;
    emitTimer = window.setTimeout(emitBatch, 250);
  }

  function wrapCanvasMethod(name) {
    const proto = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
    if (!proto || typeof proto[name] !== 'function') return;

    const original = proto[name];
    proto[name] = function wrappedCanvasText(text, x, y, maxWidth) {
      capture(name, this, text, x, y);
      return original.call(this, text, x, y, maxWidth);
    };
  }

  wrapCanvasMethod('fillText');
  wrapCanvasMethod('strokeText');

  document.addEventListener(EVENT_REQUEST, emitBatch);
})();
