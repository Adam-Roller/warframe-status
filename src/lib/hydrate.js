'use strict';

const Items = require('warframe-items');
const data = require('warframe-worldstate-data');
const flatCache = require('flat-cache');
const path = require('path');
const fetch = require('node-fetch');
const Logger = require('./logger');

const FOUR_HOURS = 14400000;
const TWO_HOURS = 7200000;
const TWO_DAYS = 172800000;
const caches = ['weapons', 'warframes', 'items', 'mods'];
const i18nOnObject = true;
const filteredItemsSrc = process.env.WFINFO_FILTERED_ITEMS;
const pricesSrc = process.env.WFINFO_PRICES;

/**
 * Cache object
 * @typedef {Object} ItemCache
 * @property {Array<module:warframe-items.Item>} weapons
 * @property {Array<module:warframe-items.Item>} warframes
 * @property {Array<module:warframe-items.Item>} items
 * @property {Array<module:warframe-items.Item>} mods
 */

/**
 * Generate a Cache object for a specified language
 * @param {string} language one of {module:warframe-worldstate-data.locales}
 * @returns {ItemCache}
 */
const makeLanguageCache = (language) => {
  const base = {
    weapons: new Items({
      category: ['Primary', 'Secondary', 'Melee', 'Arch-Melee', 'Arch-Gun'],
      i18n: language,
      i18nOnObject,
    }),
    warframes: new Items({
      category: ['Warframes', 'Archwing'],
      i18n: language,
      i18nOnObject,
    }),
    items: new Items({
      i18n: language,
      i18nOnObject,
    }),
    mods: new Items({
      category: ['Mods'],
      i18n: language,
      i18nOnObject,
    }),
  };
  const merged = {};
  caches.forEach((cacheType) => {
    const subCache = base[cacheType];
    merged[cacheType] = [...subCache].map((item) => {
      let itemClone = { ...item };
      if (language !== 'en' && itemClone.i18n && itemClone.i18n[language]) {
        itemClone = {
          ...itemClone,
          ...itemClone.i18n[language],
        };
      }
      if (itemClone.abilities) {
        itemClone.abilities = itemClone.abilities.map((ability) => ({
          uniqueName: ability.abilityUniqueName || ability.uniqueName || undefined,
          name: ability.abilityName || ability.name,
          description: ability.abilityDescription || ability.description,
        }));
      }
      delete itemClone.i18n;
      return itemClone;
    });
  });
  return merged;
};

const hydrate = async () => {
  const logger = Logger('HYDRATE');
  logger.level = 'error';
  // Items caches
  const cache = flatCache.load('.items', path.resolve(__dirname, '../../'));
  if (Date.now() - (cache.getKey('last_updt') || 0) >= FOUR_HOURS / 2) {
    data.locales.forEach((language) => {
      const cacheForLang = makeLanguageCache(language);
      caches.forEach((cacheType) => {
        cache.setKey(`${language}-${cacheType}`, cacheForLang[cacheType]);
      });
    });
    cache.setKey('last_updt', Date.now());
    cache.save(true);
  }

  // WF Info caches
  const wfInfoCache = flatCache.load('.wfinfo', path.resolve(__dirname, '../../'));
  if (Date.now() - (wfInfoCache.getKey('last_updt') || 0) >= TWO_HOURS / 2) {
    if (filteredItemsSrc) {
      await fetch(filteredItemsSrc)
        .then((d) => d.json())
        .then((d) => {
          wfInfoCache.setKey('filteredItems', d);
        });
    }
    if (pricesSrc) {
      await fetch(pricesSrc)
        .then((d) => d.json())
        .then((d) => {
          wfInfoCache.setKey('prices', d);
        });
    }
    wfInfoCache.setKey('last_updt', Date.now());
    wfInfoCache.save(true);
  }

  // Twitch extension token cache
  const twitchCache = flatCache.load('.twitch', path.resolve(__dirname, '../../'));
  const CLIENT_ID = 'b31o4btkqth5bzbvr9ub2ovr79umhh'; // twitch's client id
  const WF_ARSENAL_ID = 'ud1zj704c0eb1s553jbkayvqxjft97';
  const TWITCH_CHANNEL_ID = '89104719'; // tobitenno
  if (
    CLIENT_ID &&
    Date.now() - (twitchCache.getKey('last_updt') || 0) >= TWO_DAYS &&
    twitchCache.getKey('token') !== 'unset'
  ) {
    try {
      let raw = await fetch(`https://api.twitch.tv/v5/channels/${TWITCH_CHANNEL_ID}/extensions`, {
        headers: {
          'client-id': CLIENT_ID,
        },
      }).then((d) => d.json());
      raw = raw?.tokens?.find((s) => s.extension_id === WF_ARSENAL_ID)?.token;
      raw = raw || 'unset';
      twitchCache.setKey('token', raw);
      twitchCache.setKey('last_updt', Date.now());
      twitchCache.save(true);
    } catch (e) {
      logger.error('Cannot hydrate Twitch token');
    }
  }
};

if (process.env.BUILD && process.env.BUILD.trim() === 'build') {
  const logger = Logger('BUILD');
  logger.level = 'info';
  try {
    const start = Date.now();
    hydrate().then(() => {
      const end = Date.now();
      logger.info(`Hydration complete in ${end - start}ms`);
    });
  } catch (e) {
    logger.error(e);
  }
} else {
  module.exports = hydrate;
}
