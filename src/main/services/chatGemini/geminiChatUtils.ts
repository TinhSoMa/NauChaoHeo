import { v4 as uuidv4 } from 'uuid';

// HL_LANG (Host Language): Ngôn ngữ giao diện
export const HL_LANG = "vi";

// IMPIT BROWSERS - Danh sách trình duyệt mà impit hỗ trợ
// Mỗi tài khoản sẽ được gán 1 trình duyệt duy nhất
export type ImpitBrowser = 
  'chrome' | 'chrome100' | 'chrome101' | 'chrome104' | 'chrome107' | 'chrome110' |
  'chrome116' | 'chrome124' | 'chrome125' | 'chrome131' | 'chrome136' | 'chrome142' |
  'firefox' | 'firefox128' | 'firefox133' | 'firefox135' | 'firefox144';

export const IMPIT_BROWSERS: ImpitBrowser[] = [
  'chrome',
  'chrome100',
  'chrome101',
  'chrome104',
  'chrome107',
  'chrome110',
  'chrome116',
  'chrome124',
  'chrome125',
  'chrome131',
  'chrome136',
  'chrome142',
  'firefox',
  'firefox128',
  'firefox133',
  'firefox135',
  'firefox144'
];

// BROWSER PROFILES
// User-Agent + Platform + Sec-CH-UA presets to ensure consistency
export const BROWSER_PROFILES = [
    {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        platform: "Windows",
        secChUa: `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`,
        secChUaPlatform: `"Windows"`
    },
    {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
        platform: "Windows",
        secChUa: `"Not_A Brand";v="8", "Chromium";v="121", "Microsoft Edge";v="121"`,
        secChUaPlatform: `"Windows"`
    },
    {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        platform: "macOS",
        secChUa: `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`,
        secChUaPlatform: `"macOS"`
    },
    {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0",
        platform: "Windows",
        secChUa: "", // Firefox often empty or different
        secChUaPlatform: `"Windows"`
    }
];

export function getRandomBrowserProfile() {
    return BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
}

// Helper: Generate initial REQ_ID (Random Prefix + Fixed 4-digit Suffix logic)
// Format matches log: e.g. 4180921 (7 digits)
// We want range approx 3000000 - 5000000 initially, with random 4 digits at end.
export function generateInitialReqId(): string {
       const prefix = Math.floor(Math.random() * (45 - 30) + 30); // 30-45
       const suffix = Math.floor(Math.random() * 9000 + 1000); // 1000-9999
       // Formula: prefix * 100000 + suffix. 
       // Note: This logic places suffix at the end, but the increment of 100,000 adds to the higher digits, preserving the suffix.
       // Example: 30 * 100000 + 1234 = 3001234. Next: 3101234. Suffix 1234 preserved.
       return String(prefix * 100000 + suffix);
}

export function buildRequestPayload(
    message: string,
    contextArray: [string, string, string],
    createChatOnWeb: boolean
): string {
    if (!createChatOnWeb) {
        const innerPayload = [
            [message],
            null,
            contextArray
        ];

        return JSON.stringify([null, JSON.stringify(innerPayload)]);
    }

    const reqUuid = uuidv4().toUpperCase();
    const reqStruct = [
        [message, 0, null, null, null, null, 0],
        ["vi"],
        [contextArray[0], contextArray[1], contextArray[2], null, null, null, null, null, null, ""],
        "!BwSlBFzNAAZeabWMfmlCAOK4lSpy-nY7ADQBEArZ1HXWr3pDagC9VZ5CWddxxlroONpL-a5eGEHXpYjZYEboidltqN627255ouWfutqSAgAAAEtSAAAAAmgBB34AQf7Z0X4QHk8aehxZTrwdWe2_4ynoojTI3Dop9DkAR1EzMlT4nLjH65NoKYTZj-WO50CGSm_ENmZpEvP--1D_FnyJmQOvlsPu3GfxD62pT5siALsF-4-Jm1LJY4I7jLertSMjtvs1_R710Z6lSHhM4PuGaaOUrRMj8-UOBqCgscsTETggz3x_ju7ACGPssxINDSYvXK5XenYexuBblk9vytrqyB1E7Ntp2kHlZanL2GAf_WCWa_Zaev2j2C23Oip1rZNMfLeSnBCAy_P5w2UR5lwYfVuKIXGhG8LWt-00k1K49MV6DiTItqYyH3OC5qOmokpnUyLMrnobu3z5H9FUxZMxNjbGsl0DmDiINJQnrO7vjppHyuMrLYECDdkptAlDsQRYOcJRuazOowdqTlUwz283lg7hNoX_D4QUUG5zt2TAsrXsbFWlacIN5SeNjqlHha9tXvXB77DbcR_CzwZbF8gju5SA8ruxleoUzapriHFEXs5Ipz1c2UvB5ph1_C3PYi4ER-Dl7ykEgBZooOJPEL_4QPq4gd20gvvYiwLVeM1BiwisfZT13sJ1vhbB1XIeakQKA1Ikalf7PoCZ5tjwxn9Zsz1rRJtSSX_wfvb-lrat3XPCyjA_a-JKE-DLhIHChbouYIlTlvMT25nmWE5jemyvCj_KdHRWg0XE3wQt8jD2zmrgl8JNRygbJy9Llmfv_FAAy4TRmddSQGjpNnnTvTioiO4ydPNXFfq_M78_DxeGl56mdVf15JBZ-tqReaDDr4ltrkO09MX_CUY1cZvIqt3_QrgakGGnjc3tVZzRl2gYZ5vJBQa_pHObKly8kEQLMAYnOzB943fHjijMkw1jW1Hg7gYDEIuBPiN8mLIkl73oDPeMJSwsn4PwNm5K6V6blTxQVNylGLGlp5E5mmV92Az-bY-LqLCqTIEs0Ajd-CimLvQPTEXuMsFliaCxXsLbxrdSdrPkYIPSVUQDj7bdCs9CXo2MjPIwjHVPCmI5Cb8WPs6hu1fbYHTxLthzRejxEFdmZ0RakYqKOZFetMpzA8QN0HJ7ZIR9eA8VM4r6CB0YO0FKZcQmAHNjBPHyAqXnNZNgrZDwknPWttn9QiZH51MIBe5Hk3-zzQUvJ5fPlJlkWkd4VPzCroOIBtk6aduceg2-YQt4N701ghkxfFZ-k-blbUeFvZGIgMfbWWeJRRdrRWrrWgdT0FXT_jhJV1XA5bwZcy1X-ykmlE2CAvb1BQMUdY9YE_mJMvowLakNeo0r7Q4FOoVyu-cVhrQl7iHDmHEspUGbpa91q-7KKL0AUYxLahYd8giy5o_45o-rD1y0asaFRBhh3R0j__zg2sa1i1AA2A",
        "7f64e8c4aa4819e0a1a684fd7e6f5f9b",
        null,
        [1],
        1,
        null,
        null,
        1,
        0,
        null,
        null,
        null,
        null,
        null,
        [[0]],
        0,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        1,
        null,
        null,
        [4],
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        [1],
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        0,
        null,
        null,
        null,
        null,
        null,
        reqUuid,
        null,
        [],
        null,
        null,
        null,
        null,
        [Math.floor(Date.now() / 1000), Math.floor((Date.now() % 1000) * 1000000)], // DYNAMIC TIMESTAMP!
        null,
        2
    ];

    return JSON.stringify([null, JSON.stringify(reqStruct)]);
}
