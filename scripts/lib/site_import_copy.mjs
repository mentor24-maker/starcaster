/**
 * Copy the promoted assets of a Site Import apply into the project's own
 * namespace, tolerating an ORIGIN that refuses.
 *
 * An asset whose capture download failed has no stored copy, so the mapper
 * falls back to its original URL. If the origin refuses that too, the run
 * used to throw — and one HubSpot button image (HTTP 403) stopped all 17
 * pages of alphire.agency from being built (2026-10-27, task 86bct8t95).
 *
 * Only a failure to READ the source is tolerated: that image keeps its
 * original URL in the page (exactly what the original site showed) and is
 * named in `skipped`, so nothing is dropped silently. A failure to WRITE to
 * our own storage still throws — that is our problem, not the origin's.
 */

export class SourceUnreachableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SourceUnreachableError';
  }
}

/**
 * @param {Array<{assetId:string, fromUrl:string, mimeType?:string}>} assets
 * @param {(fromUrl:string, toPathname:string, mimeType:string) => Promise<string>} copyBlob
 *   throws SourceUnreachableError when the source cannot be read
 * @param {string} appliedPrefix  e.g. SiteImportApplied/<projectId>
 * @param {Map<string,string>} urlMap  filled in place: fromUrl → copied URL
 * @returns {Promise<Array<{assetId:string, fromUrl:string, reason:string}>>} the skipped assets
 */
export async function copyPromotedAssets(assets, copyBlob, appliedPrefix, urlMap) {
  const skipped = [];
  for (const asset of assets) {
    if (!asset.fromUrl || urlMap.has(asset.fromUrl)) continue;
    const ext = (asset.fromUrl.match(/\.([a-z0-9]{2,5})(?:\?|$)/i) || [])[1] || 'bin';
    try {
      urlMap.set(asset.fromUrl, await copyBlob(
        asset.fromUrl,
        `${appliedPrefix}/assets/${asset.assetId}.${ext}`,
        asset.mimeType || 'application/octet-stream',
      ));
    } catch (err) {
      if (!(err instanceof SourceUnreachableError)) throw err;
      skipped.push({ assetId: asset.assetId, fromUrl: asset.fromUrl, reason: err.message });
    }
  }
  return skipped;
}
