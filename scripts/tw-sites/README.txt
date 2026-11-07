scripts/tw-sites: one generator, three static sites (wave 36, sites-three)

  python3 -I scripts/tw-sites/build_sites.py --out <dir>            builds <dir>/trustintheweb-org, trustintheweb-com, trustweb-one
  python3 -I -m unittest discover -s scripts -p 'test_tw_site.py'   tests (three builds, links, rehost check, 360/1280 px screens)
  scripts/tw-sites/deploy_sites.sh --dry                            prints the deploy plan, changes nothing (DEPLOY.txt has the rest)

Files
  build_sites.py          the generator; reuses scripts/tw-front-door fragments through tw_site's helpers; no server contact
  sites.css               layout on the design tokens (apps/trustweb/src/design/tokens.css); a colour skin per site is generated
  check_screens.mjs       headless 360/1280 px overflow check + screenshots (PLAYWRIGHT_PACKAGE=<playwright-core/index.js>)
  render_site_icons.mjs   renders assets/<site>/*.png (install icons) from the holarchic ring; the PNGs are committed
  deploy_sites.sh, DEPLOY.txt   deploy preparation, nothing applied
New page bodies: scripts/tw-front-door/sites/ (org-hero, com-index, one-index). Existing fragments are untouched.
Roles and design: docs/sites.txt.
