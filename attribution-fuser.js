/**
 * AttributionFuser — pure logic module that fuses per-face lip-energy
 * history with voice activity (VAD) over time to answer "who spoke
 * during time window [t0, t1]?"
 *
 * No I/O of any kind (no camera, mic, DOM, or internal timers). All
 * timestamps are supplied by the caller. Runs identically in browser
 * and Node.
 */

/**
 * @typedef {string|number} FaceId
 *   Note: the strings 'multiple' and 'unknown' are reserved result labels;
 *   avoid using them as face ids or attribution results become ambiguous.
 *
 * @typedef {Object} AttributionResult
 * @property {FaceId|'multiple'|'unknown'} speaker
 * @property {number} confidence - 0-1, fraction of voiced frames won by `speaker`
 */

/**
 * Determine the per-frame vote given a snapshot of face energies.
 * @param {Map<FaceId, number>} energiesMap
 * @param {number} minEnergy
 * @param {number} dominanceRatio
 * @returns {FaceId|'multiple'|'unknown'}
 */
function computeFrameVote(energiesMap, minEnergy, dominanceRatio) {
  const entries = Array.from(energiesMap.entries());
  if (entries.length === 0) return 'unknown';

  entries.sort((a, b) => b[1] - a[1]);
  const [topId, topEnergy] = entries[0];
  const runnerUpEnergy = entries.length > 1 ? entries[1][1] : 0;

  if (topEnergy < minEnergy) return 'unknown';
  if (topEnergy >= runnerUpEnergy * dominanceRatio) return topId;
  return 'multiple';
}

export class AttributionFuser {
  /**
   * @param {Object} [options]
   * @param {number} [options.dominanceRatio=1.7] - top face must beat runner-up by this factor
   * @param {number} [options.minEnergy=0.00004] - below this, nobody is visually speaking
   * @param {number} [options.historyMs=30000] - how much attribution history to retain
   */
  constructor(options = {}) {
    /** @type {number} */
    this.dominanceRatio = options.dominanceRatio ?? 1.7;
    /** @type {number} */
    this.minEnergy = options.minEnergy ?? 0.00004;
    /** @type {number} */
    this.historyMs = options.historyMs ?? 30000;

    /**
     * @type {Array<{ t: number, vadActive: boolean, vote: (FaceId|'multiple'|'unknown'|null) }>}
     * @private
     */
    this._frames = [];
  }

  /**
   * Record one frame of observations. Call every frame (or every N ms).
   * @param {number} timestampMs
   * @param {Map<FaceId, number>} energiesMap - lip energy per visible face
   * @param {boolean} vadActive - is the mic hearing speech right now
   * @returns {void}
   */
  record(timestampMs, energiesMap, vadActive) {
    if (!Number.isFinite(timestampMs)) return;
    const map = energiesMap instanceof Map ? energiesMap : new Map();
    const vote = vadActive
      ? computeFrameVote(map, this.minEnergy, this.dominanceRatio)
      : null;

    this._frames.push({ t: timestampMs, vadActive: !!vadActive, vote });
    this._prune(timestampMs);
  }

  /**
   * Drop frames older than historyMs relative to the given reference time.
   * @param {number} referenceT
   * @private
   * @returns {void}
   */
  _prune(referenceT) {
    const cutoff = referenceT - this.historyMs;
    let firstKept = 0;
    while (firstKept < this._frames.length && this._frames[firstKept].t < cutoff) {
      firstKept++;
    }
    if (firstKept > 0) this._frames.splice(0, firstKept);
  }

  /**
   * Discard all recorded history, e.g. when a capture session restarts.
   * Configuration (dominanceRatio, minEnergy, historyMs) is kept.
   * @returns {void}
   */
  reset() {
    this._frames.length = 0;
  }

  /**
   * Determine who owned a time window, e.g. when an ASR chunk finishes.
   * @param {number} t0
   * @param {number} t1
   * @returns {AttributionResult}
   */
  attribute(t0, t1) {
    const voiced = this._frames.filter(
      (f) => f.t >= t0 && f.t <= t1 && f.vadActive
    );

    if (voiced.length === 0) {
      return { speaker: 'unknown', confidence: 0 };
    }

    const counts = new Map();
    for (const f of voiced) {
      counts.set(f.vote, (counts.get(f.vote) || 0) + 1);
    }

    let max = 0;
    for (const c of counts.values()) {
      if (c > max) max = c;
    }

    const winners = [];
    for (const [key, c] of counts.entries()) {
      if (c === max) winners.push(key);
    }

    const speaker = winners.length > 1 ? 'multiple' : winners[0];
    const confidence = max / voiced.length;

    return { speaker, confidence };
  }

  /**
   * Same shape as attribute(), but for the latest recorded frame only.
   * Intended for live UI display.
   * @returns {AttributionResult}
   */
  instantWinner() {
    if (this._frames.length === 0) {
      return { speaker: 'unknown', confidence: 0 };
    }

    const last = this._frames[this._frames.length - 1];
    if (!last.vadActive) {
      return { speaker: 'unknown', confidence: 0 };
    }

    return { speaker: last.vote, confidence: 1 };
  }
}
