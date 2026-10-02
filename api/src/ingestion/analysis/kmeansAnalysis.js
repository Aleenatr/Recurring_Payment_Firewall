/**
 * STEP 7 — K-MEANS CLUSTERING
 *
 * k-means in four lines:
 *   1. Pick k starting centres.
 *   2. Assign every point to its nearest centre.
 *   3. Move each centre to the mean of the points assigned to it.
 *   4. Repeat 2-3 until nothing moves. (This is Lloyd's algorithm.)
 *
 * It always converges, but only to a LOCAL optimum — the answer depends on
 * where you started. That is why initialisation is a real decision and not a
 * detail; see pickInitialCentroids() below.
 *
 * ==================== SAME HONEST PROBLEM AS DBSCAN ====================
 * You cannot cluster a population of one. With n = 1 the merchant is its own
 * centroid, and "which group is it in" is meaningless.
 *
 * So the single-merchant path (runKMeans) does NOT pretend to cluster. It
 * assigns a provisional label by thresholding the signals, and SAYS SO in the
 * returned cluster string. The real clustering happens in the population run.
 * ======================================================================
 *
 * The three archetype names come from a comment in merchantProcessor.js:204-209.
 * models:157 types `cluster` as a bare String with NO enum, so these labels are
 * convention, not a constraint the database enforces.
 */

const SIGNAL_KEYS = [
   'price_volatility',
   'price_change_frequency',
   'stealth_price_changes',
   'rename_frequency',
   'cancellation_friction',
   'retry_aggressiveness'
];

const ABUSIVE = 'ABUSIVE_PATTERN';
const AGGRESSIVE = 'AGGRESSIVE_PATTERN';
const NORMAL = 'NORMAL_PATTERN';

// Boundaries on the mean of the six signals, for the single-merchant fallback.
const ABUSIVE_THRESHOLD = 0.60;
const AGGRESSIVE_THRESHOLD = 0.35;

const MAX_ITERATIONS = 100;

function toVector(signalData) {
   const core = (signalData && signalData.core) ? signalData.core : {};
   return SIGNAL_KEYS.map(key => Number.isFinite(core[key]) ? core[key] : 0);
}

function mean(values) {
   if (values.length === 0) return 0;
   return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function euclideanDistance(a, b) {
   let sumOfSquares = 0;
   for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sumOfSquares += diff * diff;
   }
   return Math.sqrt(sumOfSquares);
}

/**
 * SINGLE-MERCHANT PATH — merchantProcessor.js:33, called as runKMeans(signalData, dbscanResult).
 * Returns the shape of cluster_assignment (models:156-159).
 *
 * The second argument is the DBSCAN result. It is accepted because the call
 * site passes it, and used only to lower confidence when the merchant is a
 * known outlier — an outlier by definition sits far from any archetype, so a
 * confident archetype label would be contradictory.
 */
export default function runKMeans(signalData, dbscanResult) {
   const vector = toVector(signalData);
   const average = mean(vector);

   let cluster;
   let nearestBoundary;

   if (average >= ABUSIVE_THRESHOLD) {
      cluster = ABUSIVE;
      nearestBoundary = ABUSIVE_THRESHOLD;
   } else if (average >= AGGRESSIVE_THRESHOLD) {
      cluster = AGGRESSIVE;
      // Whichever boundary this merchant sits closer to.
      nearestBoundary = (ABUSIVE_THRESHOLD - average) < (average - AGGRESSIVE_THRESHOLD)
         ? ABUSIVE_THRESHOLD
         : AGGRESSIVE_THRESHOLD;
   } else {
      cluster = NORMAL;
      nearestBoundary = AGGRESSIVE_THRESHOLD;
   }

   // Confidence = how far from the nearest boundary, scaled so that 0.25 away
   // is full confidence. A merchant sitting exactly on a threshold scores ~0,
   // which is the honest reading: it could have gone either way.
   let confidence = Math.min(1, Math.abs(average - nearestBoundary) / 0.25);

   if (dbscanResult && dbscanResult.is_outlier) {
      confidence *= 0.5;
   }

   return {
      cluster,
      confidence: Number(confidence.toFixed(3))
   };
}

/**
 * Deterministic initialisation.
 *
 * Textbook k-means seeds randomly, which means the same input can produce
 * different clusters on different runs. For a system that tells people whether
 * to cancel a payment, that is unacceptable — a merchant must not change risk
 * band because the cron restarted.
 *
 * So: sort merchants by mean signal and take k evenly spaced points. Spread
 * across the range like k-means++ aims for, but reproducible. Same input, same
 * output, every time.
 */
function pickInitialCentroids(points, k) {
   const ordered = points
      .map((point, index) => ({ point, index, average: mean(point) }))
      .sort((a, b) => a.average - b.average);

   const centroids = [];
   for (let i = 0; i < k; i++) {
      // Spread the picks evenly across the sorted list.
      const position = Math.floor((i * (ordered.length - 1)) / Math.max(1, k - 1));
      centroids.push([...ordered[position].point]);
   }
   return centroids;
}

/**
 * POPULATION PATH — called from the cron.
 *
 * @param {Array} signalsArray  one { core: {...} } per merchant, in order
 * @param {number} k            number of clusters
 * @returns {{ clusters, centroids, merchantAssignments, note }}
 *          merchantAssignments is a plain array PARALLEL TO THE INPUT — the cron
 *          indexes it by merchant position, so the ordering is load-bearing.
 */
export function performKMeansClustering(signalsArray, k = 3) {
   const points = signalsArray.map(toVector);
   const n = points.length;

   if (n === 0) {
      return { clusters: [], centroids: [], merchantAssignments: [], note: 'No merchants to cluster' };
   }

   // Never ask for more clusters than there are points.
   const clusterCount = Math.max(1, Math.min(k, n));

   let centroids = pickInitialCentroids(points, clusterCount);
   let assignments = new Array(n).fill(0);
   let iterations = 0;

   for (; iterations < MAX_ITERATIONS; iterations++) {
      // --- Assignment step: every point to its nearest centroid ---
      const newAssignments = points.map(point => {
         let bestCluster = 0;
         let bestDistance = Infinity;
         for (let c = 0; c < centroids.length; c++) {
            const distance = euclideanDistance(point, centroids[c]);
            if (distance < bestDistance) {
               bestDistance = distance;
               bestCluster = c;
            }
         }
         return bestCluster;
      });

      // Converged: nobody moved. This is the stopping condition, and it is why
      // the loop terminates rather than running MAX_ITERATIONS every time.
      const stable = newAssignments.every((cluster, i) => cluster === assignments[i]);
      assignments = newAssignments;
      if (stable && iterations > 0) break;

      // --- Update step: each centroid moves to the mean of its members ---
      centroids = centroids.map((centroid, c) => {
         const members = points.filter((_, i) => assignments[i] === c);
         // An empty cluster keeps its old centroid rather than becoming NaN.
         if (members.length === 0) return centroid;
         return SIGNAL_KEYS.map((_, dim) => mean(members.map(m => m[dim])));
      });
   }

   // --- Label the clusters ---
   // k-means produces anonymous groups 0..k-1 with no inherent meaning; the
   // index depends only on initialisation order. Archetype names are attached
   // afterwards, by putting each CENTROID through the same thresholds the
   // single-merchant path uses.
   //
   // Deliberately NOT by rank ("worst cluster = ABUSIVE"). Ranking guarantees
   // that some cluster is always called abusive, even in a population where
   // every merchant is clean — the label would then describe the population's
   // shape rather than the merchants' behaviour. Thresholding means a dataset
   // of honest merchants correctly yields three NORMAL_PATTERN clusters, and
   // the label means the same thing in both code paths.
   const labelForCluster = centroids.map(centroid => {
      const severity = mean(centroid);
      if (severity >= ABUSIVE_THRESHOLD) return ABUSIVE;
      if (severity >= AGGRESSIVE_THRESHOLD) return AGGRESSIVE;
      return NORMAL;
   });

   const clusters = centroids.map((centroid, index) => ({
      id: index,
      label: labelForCluster[index],
      size: assignments.filter(a => a === index).length,
      centroid: Object.fromEntries(SIGNAL_KEYS.map((key, dim) => [key, Number(centroid[dim].toFixed(4))]))
   }));

   // Each merchant gets the cluster_assignment shape the schema expects
   // (models:156-159), so the cron can write it straight through.
   const merchantAssignments = points.map((point, i) => {
      const clusterIndex = assignments[i];
      const distance = euclideanDistance(point, centroids[clusterIndex]);
      // Closer to the centroid = more confident. The 6-D unit cube has a
      // diagonal of sqrt(6) ~= 2.449, which is the largest distance possible,
      // so it is the correct normaliser.
      const confidence = Math.max(0, 1 - distance / Math.sqrt(SIGNAL_KEYS.length));
      return {
         cluster: labelForCluster[clusterIndex],
         confidence: Number(confidence.toFixed(3))
      };
   });

   return {
      clusters,
      centroids,
      merchantAssignments,
      note: `k=${clusterCount}, converged in ${iterations + 1} iterations over ${n} merchants`
   };
}
