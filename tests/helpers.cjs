// 显式等待异步状态，避免自动化运行器将 Promise 本身视为条件成立。
async function waitForCondition(condition, timeout = 10000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await condition();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 80));
  } while (Date.now() < deadline);
  throw new Error('等待状态超时');
}
const waitForState = (page, predicate, timeout) => waitForCondition(async () => predicate(await page.evaluate(() => window.studyDesk.load())), timeout);
module.exports = { waitForCondition, waitForState };
