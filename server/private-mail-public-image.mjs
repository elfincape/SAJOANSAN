import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { inspectMailImage } from '../supabase/functions/onedrive-auth/private-mail-images.js';
const canonical = (address) =>
  isIP(address) === 6
    ? new URL('https://[' + address + ']/').hostname
    : address;
export function isPublicMailImageAddress(address) {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family === 6) {
    const hex = canonical(address).slice(1, -1).toLowerCase();
    return (
      /^[23]/.test(hex) &&
      !/^2001:(?:0*:|db8:|10:|20:|2:)/.test(hex) &&
      !/^2002:|^3ff[ef]:/.test(hex)
    );
  }
  return false;
}
function approvedUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    isIP(url.hostname) ||
    !/^[a-z][a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)
  )
    throw Error('REMOTE_IMAGE_SOURCE');
  return url;
}
export async function downloadPublicMailImage(
  value,
  {
    lookup = dnsLookup,
    requester = httpsRequest,
    timeoutMs = 4500,
    maxBytes = 2100000,
  } = {},
) {
  const url = approvedUrl(value),
    controller = new AbortController();
  let stage = 'dns';
  let rejectDeadline;
  const deadline = new Promise((_, reject) => {
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => {
    controller.abort();
    rejectDeadline(Error('REMOTE_IMAGE_TIMEOUT'));
  }, timeoutMs);
  try {
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true, verbatim: true }),
      deadline,
    ]);
    if (
      !addresses.length ||
      addresses.length > 32 ||
      addresses.some((item) => !isPublicMailImageAddress(item.address))
    )
      throw Error('REMOTE_IMAGE_SOURCE');
    const pin = addresses[0];
    stage = 'request';
    const result = await Promise.race([
      new Promise((resolve, reject) => {
        const request = requester(
          url,
          {
            method: 'GET',
            agent: false,
            servername: url.hostname,
            rejectUnauthorized: true,
            autoSelectFamily: false,
            signal: controller.signal,
            maxHeaderSize: 16384,
            lookup: (hostname, options, callback) => {
              if (hostname !== url.hostname)
                return callback(Error('REMOTE_IMAGE_SOURCE'));
              callback(null, pin.address, pin.family);
            },
            headers: { Accept: 'image/png,image/jpeg,image/webp' },
          },
          async (response) => {
            try {
              stage = 'headers';
              if (
                response.statusCode !== 200 ||
                !response.socket?.authorized ||
                canonical(response.socket.remoteAddress) !==
                  canonical(pin.address) ||
                !/^image\/(?:png|jpeg|webp)(?:;|$)/i.test(
                  response.headers['content-type'] ?? '',
                ) ||
                Number(response.headers['content-length'] ?? 0) > maxBytes ||
                (response.headers['content-encoding'] &&
                  response.headers['content-encoding'] !== 'identity')
              )
                throw Error('REMOTE_IMAGE_SOURCE');
              stage = 'body';
              const parts = [];
              let length = 0;
              for await (const chunk of response) {
                length += chunk.length;
                if (length > maxBytes) throw Error('IMAGE_LIMIT');
                parts.push(chunk);
              }
              stage = 'image';
              const bytes = Buffer.concat(parts, length),
                info = inspectMailImage(bytes);
              if (
                !['image/png', 'image/jpeg', 'image/webp'].includes(
                  info.mediaType,
                ) ||
                info.width <= 2 ||
                info.height <= 2 ||
                info.width > 8000 ||
                info.height > 8000
              )
                throw Error('REMOTE_IMAGE_SOURCE');
              resolve(
                new Response(bytes, {
                  headers: {
                    'Content-Type': info.mediaType,
                    'Content-Length': String(length),
                    'Cache-Control': 'no-store',
                  },
                }),
              );
            } catch (error) {
              response.destroy();
              reject(error);
            }
          },
        );
        request.once('error', () => reject(Error('REMOTE_IMAGE_SOURCE')));
        request.end();
      }),
      deadline,
    ]);
    return result;
  } catch (error) {
    error.remoteStage = stage;
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
