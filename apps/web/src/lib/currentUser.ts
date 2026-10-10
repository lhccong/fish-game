/**
 * 统一的"当前用户 id"取数。
 *
 * 优先使用摸鱼岛登录用户（FishUser.id，OAuth2 userinfo 返回的稳定字符串），
 * 未登录时返回 'anon'，由调用方决定如何处理（通常后端会拒绝"anon"上传）。
 *
 * 与 LocalUser 的区别：LocalUser 是浏览器本地随机身份（`user_<uuid>`），
 * 仅用于本地 IndexedDB 条目、占位等"和后端无关"的场景；上传/共享资源
 * 全部要走摸鱼岛登录用户，保证跨设备可定位。
 */

import { getCachedFishUser } from './fishUser';

export const ANON_USER_ID = 'anon';

/** 返回摸鱼岛登录用户 id；未登录时返回 'anon'。 */
export function getCurrentUserId(): string {
  const fish = getCachedFishUser();
  if (fish && typeof fish.id === 'string' && fish.id.length > 0) {
    return fish.id;
  }
  return ANON_USER_ID;
}

export function isLoggedIn(): boolean {
  return getCurrentUserId() !== ANON_USER_ID;
}
