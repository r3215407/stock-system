import assert from "node:assert/strict";
import test from "node:test";

import { buildTencentDailyKlineParam } from "../lib/tencent-kline.ts";

test("腾讯未复权日线保留末尾空参数", () => {
  assert.equal(buildTencentDailyKlineParam("sh600409", 1500, "none"), "sh600409,day,,,1500,");
});

test("腾讯前复权日线包含 qfq 参数", () => {
  assert.equal(buildTencentDailyKlineParam("sh600409", 320, "qfq"), "sh600409,day,,,320,qfq");
});
