/**
 * STEP 6 — DBSCAN OUTLIER DETECTION
 *
 * DBSCAN = Density-Based Spatial Clustering of Applications with Noise.
 * The idea in one line: a point in a crowded neighbourhood belongs to a cluster;
 * a point with nobody near it is NOISE — an outlier.
 *
 * Two parameters:
 *   eps     — the radius that defines "near"
 *   minPts  — how many neighbours within eps you need to count as crowded
 *
 * Unlike k-means it does not need k in advance, and it has an explicit category
 * for "this point belongs to nothing", which is exactly what an outlier is.
 *
 * ==================== THE HONEST PROBLEM, STATED UP FRONT ===================
 * The single-merchant path CANNOT DO THIS.
 *
 * Density is defined relative to neighbours. With one merchant there are no
 * neighbours, so every point is trivially isolated and "is it an outlier?" has
 * no answer — not a hard answer, NO answer.
 *
 * So runDBSCAN() returns is_outlier:false with a method string that says why,
 * rather than fabricating a score. A made-up anomaly number in a product that
 * tells people to cancel payments is worse than an absent one.
 *
 * The real detection lives in performDBSCANClustering(), which runs over the
 * whole merchant population in the six-hourly cron. THIS IS WHY THE CRON JOB
 * EXISTS. It is not a refresh for freshness — it is the only place where
 * outlier detection and clustering are mathematically defined at all.
 * ===========================================================================
 */

// Order is fixed: every merchant becomes a point in the same 6-dimensional
// space, so the axes must line up across merchants.
const SIGNAL_KEYS = [
   'price_volatility',
   'price_change_frequency',
   'stealth_price_changes',
   'rename_frequency',
   'cancellation_friction',
   'retry_aggressiveness'
];

const DEFAULT_EPS = 0.3;
const DEFAULT_MIN_PTS = 2;

/** { core: {...} } -> [n1, n2, ... n6] */
function toVector(signalData) {
   const core = (signalData && signalData.core) ? signalData.core : {};
   return SIGNAL_KEYS.map(key => Number.isFinite(core[key]) ? core[key] : 0);
}

/**
 * Straight-line distance in 6 dimensions.
 * No feature scaling is applied, and none is needed: extractSignals already
 * guarantees every axis is on the same 0..1 scale. If a raw dollar amount ever
 * gets added as a seventh axis, it would dominate this distance and scaling
 * would become mandatory.
 */
function euclideanDistance(a, b) {
   let sumOfSquares = 0;
   for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sumOfSquares += diff * diff;
   }
   return Math.sqrt(sumOfSquares);
}

/**
 * SINGLE-MERCHANT PATH — called from merchantProcessor.js:31 on ingest.
 * Returns the shape of anomaly_analysis (models:151-155).
 */
export default function runDBSCAN(_signalData) {
   return {
      is_outlier: false,
      anomaly_score: 0,
      method: 'DBSCAN (deferred: density is undefined for a single merchant; resolved by the population run)'
   };
}

/**
 * POPULATION PATH — called from the cron over every merchant at once.
 *
 * @param {Array} signalsArray  one { core: {...} } per merchant, in order
 * @param {number} eps          neighbourhood radius
 * @param {number} minPts       neighbours needed to be a core point
 * @returns {{ labels, outliers, clusterCount, perMerchant }}
 *          perMerchant[i] is the anomaly_analysis object for merchant i.
 */
export function performDBSCANClustering(signalsArray, eps = DEFAULT_EPS, minPts = DEFAULT_MIN_PTS) {
   const points = signalsArray.map(toVector);
   const n = points.length;

   const NOISE = -1;
   const UNVISITED = undefined;
   const labels = new Array(n).fill(UNVISITED);

   // Precompute neighbours. O(n^2) — fine for the hundreds of merchants this
   // handles, and the honest ceiling. Beyond ~10k merchants this needs a
   // spatial index (k-d tree or ball tree) or it becomes the slowest thing in
   // the cron.
   const neighboursOf = (index) => {
      const found = [];
      for (let j = 0; j < n; j++) {
         if (euclideanDistance(points[index], points[j]) <= eps) found.push(j);
      }
      return found;
   };

   let clusterId = 0;

   for (let i = 0; i < n; i++) {
      if (labels[i] !== UNVISITED) continue;

      const neighbours = neighboursOf(i);

      // Not enough company: provisionally noise. It may still be pulled into a
      // cluster later as a BORDER point, which is why this is not final.
      if (neighbours.length < minPts) {
         labels[i] = NOISE;
         continue;
      }

      // Start a new cluster and grow it outward from this core point.
      labels[i] = clusterId;
      const queue = neighbours.filter(j => j !== i);

      for (let q = 0; q < queue.length; q++) {
         const neighbour = queue[q];

         // A point previously marked noise is a border point of this cluster.
         if (labels[neighbour] === NOISE) labels[neighbour] = clusterId;
         if (labels[neighbour] !== UNVISITED) continue;

         labels[neighbour] = clusterId;

         // Only CORE points extend the cluster further. Border points join but
         // do not recruit — that is what stops two dense regions joined by a
         // thin thread from merging into one.
         const neighbourNeighbours = neighboursOf(neighbour);
         if (neighbourNeighbours.length >= minPts) {
            for (const candidate of neighbourNeighbours) {
               if (!queue.includes(candidate)) queue.push(candidate);
            }
         }
      }

      clusterId++;
   }

   // Anomaly score for the points that ended up as noise: how far away is the
   // nearest other merchant, relative to eps. Just outside the radius scores
   // near 0; twice the radius away or more scores 1.
   const perMerchant = points.map((point, i) => {
      const isOutlier = labels[i] === NOISE;

      if (!isOutlier) {
         return { is_outlier: false, anomaly_score: 0, method: 'DBSCAN' };
      }

      let nearest = Infinity;
      for (let j = 0; j < n; j++) {
         if (j === i) continue;
         nearest = Math.min(nearest, euclideanDistance(point, points[j]));
      }

      // Alone in the dataset: maximally anomalous by definition.
      const score = Number.isFinite(nearest)
         ? Math.max(0, Math.min(1, (nearest - eps) / eps))
         : 1;

      return { is_outlier: true, anomaly_score: score, method: 'DBSCAN' };
   });

   return {
      labels,
      outliers: labels.map((label, i) => label === NOISE ? i : -1).filter(i => i !== -1),
      clusterCount: clusterId,
      perMerchant
   };
}
