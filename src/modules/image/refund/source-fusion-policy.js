export const refundSourceFusion = Object.freeze({
  provider: 'SourceFusion',
  profile: 'image-source-extra-trees-v1',
  threshold: 0.47332282007791726,
});

export function validRefundSourceFusion(source) {
  return source?.provider === refundSourceFusion.provider &&
    source.profile === refundSourceFusion.profile &&
    Number.isFinite(source.generatedScore) && source.generatedScore >= 0 && source.generatedScore <= 1;
}

export function refundSourceFusionRisk(score) {
  return score >= refundSourceFusion.threshold ? 'medium' : 'low';
}
