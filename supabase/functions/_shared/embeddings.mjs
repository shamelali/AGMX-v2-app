// Storage uses halfvec(2048). Use the same native coordinates when indexing and searching.
export const storedDimensions = 2048;

/** @param {"openai"|"nvidia"} provider @param {string} model @param {string} text @param {"query"|"passage"} purpose */
export function embeddingRequest(provider, model, text, purpose) {
  if (provider === "nvidia") return { model, input: text, input_type: purpose, truncate: "END" };
  // Older OpenAI embedding models return their native size and do not accept dimensions.
  if (model.startsWith("text-embedding-3-")) {
    return { model, input: text, dimensions: model === "text-embedding-3-small" ? 1536 : storedDimensions };
  }
  return { model, input: text };
}

/** @param {unknown} vector @param {number|undefined} expected */
export function storageVector(vector, expected) {
  if (!Array.isArray(vector) || !vector.length || vector.length > storedDimensions ||
      (expected !== undefined && vector.length !== expected) || !vector.every(Number.isFinite)) {
    throw new Error("The embedding model returned an unexpected vector");
  }
  // Appending zeros preserves both the norm and cosine distance of the native vector.
  return vector.concat(Array(storedDimensions - vector.length).fill(0));
}
