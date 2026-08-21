import assert from "node:assert/strict";
import test from "node:test";

import {
  getMa20DistanceScore,
  getMa60RelationshipScore,
  getPullbackAmplitudeScore,
  getStopDistanceRiskAdjustment,
} from "../lib/evaluation.ts";

test("回调幅度使用左闭右开区间", () => {
  assert.equal(getPullbackAmplitudeScore(0.019999), 0);
  assert.equal(getPullbackAmplitudeScore(0.02), 5);
  assert.equal(getPullbackAmplitudeScore(0.03), 7);
  assert.equal(getPullbackAmplitudeScore(0.06), 5);
  assert.equal(getPullbackAmplitudeScore(0.08), 3);
  assert.equal(getPullbackAmplitudeScore(0.1), 0);
});

test("MA20距离在3%和5%边界正确计分", () => {
  assert.equal(getMa20DistanceScore(0.03), 6);
  assert.equal(getMa20DistanceScore(0.030001), 3);
  assert.equal(getMa20DistanceScore(0.05), 3);
  assert.equal(getMa20DistanceScore(0.050001), 0);
});

test("MA60关系在100%和98%边界正确计分", () => {
  assert.equal(getMa60RelationshipScore(1), 6);
  assert.equal(getMa60RelationshipScore(0.999999), 3);
  assert.equal(getMa60RelationshipScore(0.98), 3);
  assert.equal(getMa60RelationshipScore(0.979999), 0);
});

test("止损距离8%、10%、12%边界正确应用风险系数", () => {
  assert.deepEqual(getStopDistanceRiskAdjustment(0.08, 70), { factor: 1, executable: true, label: "正常风险" });
  assert.deepEqual(getStopDistanceRiskAdjustment(0.080001, 70), { factor: 0.5, executable: true, label: "半风险" });
  assert.deepEqual(getStopDistanceRiskAdjustment(0.1, 70), { factor: 0.5, executable: true, label: "半风险" });
  assert.deepEqual(getStopDistanceRiskAdjustment(0.100001, 79), { factor: 0.25, executable: false, label: "需总分至少80分" });
  assert.deepEqual(getStopDistanceRiskAdjustment(0.12, 80), { factor: 0.25, executable: true, label: "四分之一风险" });
  assert.deepEqual(getStopDistanceRiskAdjustment(0.120001, 100), { factor: 0, executable: false, label: "超过可执行范围" });
});
