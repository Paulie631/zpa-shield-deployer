// The test-app catalog, shared by the deploy script, ZPA publishing and the AWS network rules.
//
// Why six endpoints for two-and-a-half apps: App Shield fingerprints by port and runs a TLS
// phase, so the same app exposed on a standard port, behind TLS and on its native port gives
// the scanner far more to recognise. Each endpoint gets its own ZPA app segment, which also
// keeps ZPA's one-scan-request-per-segment lock from blocking everything at once.
const TEST_APPS = [
  { key: 'dvwa',        name: 'ZPA Shield - DVWA',                  port: 80,   scheme: 'http',  app: 'DVWA',       via: 'direct' },
  { key: 'dvwa-tls',    name: 'ZPA Shield - DVWA (TLS)',            port: 443,  scheme: 'https', app: 'DVWA',       via: 'nginx' },
  { key: 'juice',       name: 'ZPA Shield - Juice Shop',            port: 3000, scheme: 'http',  app: 'Juice Shop', via: 'direct' },
  { key: 'juice-8080',  name: 'ZPA Shield - Juice Shop (HTTP 8080)', port: 8080, scheme: 'http',  app: 'Juice Shop', via: 'nginx' },
  { key: 'juice-tls',   name: 'ZPA Shield - Juice Shop (TLS)',      port: 8443, scheme: 'https', app: 'Juice Shop', via: 'nginx' },
  { key: 'webgoat',     name: 'ZPA Shield - WebGoat',               port: 8081, scheme: 'http',  app: 'WebGoat',    via: 'direct' },
  // Old mainstream server software: version-based CVE matching and exploit confirmation have real material here
  { key: 'httpd',       name: 'ZPA Shield - Apache httpd 2.4.49',   port: 8082, scheme: 'http',  app: 'Apache httpd', via: 'direct' },
  { key: 'tomcat',      name: 'ZPA Shield - Tomcat 8.5',            port: 8083, scheme: 'http',  app: 'Tomcat',     via: 'direct' },
  { key: 'wordpress',   name: 'ZPA Shield - WordPress 4.9',         port: 8084, scheme: 'http',  app: 'WordPress',  via: 'direct' },
];
const TEST_APP_PORTS = TEST_APPS.map(a => a.port);

// Pinned, deliberately dated images: App Shield counts known CVEs in detected software,
// so older builds give version-based matching more to find.
const IMAGES = {
  dvwa: 'vulnerables/web-dvwa',          // PHP 7 / Apache 2.4.25 era
  juice: 'bkimminich/juice-shop:v13.3.0', // 2022 build on Node 16
  webgoat: 'webgoat/webgoat:v2023.4',
  nginx: 'nginx:1.18.0',                  // 2020 nginx as the TLS front door
  httpd: 'httpd:2.4.49',                  // the 2021 path-traversal release — App Shield's own check confirms it
  tomcat: 'tomcat:8.5.0-jre8',            // early 8.5 line: long version-CVE list, Java fingerprint
  wordpress: 'wordpress:4.9.0-php7.0-apache', // dated CMS on old PHP; large Nuclei template family
  mysql: 'mysql:5.7',                     // backing store for WordPress (not exposed)
};
// Memory the test-apps VM needs with everything running (Tomcat + WordPress/MySQL push it past 4 GB)
const TEST_APPS_INSTANCE_TYPE = 't3.large';

const urlFor = (ip, a) => `${a.scheme}://${ip}${(a.scheme === 'http' && a.port === 80) || (a.scheme === 'https' && a.port === 443) ? '' : ':' + a.port}/`;

module.exports = { TEST_APPS, TEST_APP_PORTS, IMAGES, TEST_APPS_INSTANCE_TYPE, urlFor };
