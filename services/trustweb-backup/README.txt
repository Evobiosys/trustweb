trustweb-backup: encrypted-blob store for TrustWeb ("back it up on a Swiss server?")

The server stores opaque ciphertext made on the phone (apps/trustweb/src/backup.ts).
It cannot read it. API, status codes and env vars are documented at the top of server.mjs.

RUN (local)
  BACKUP_DIR=/tmp/twbackup PORT=8960 node server.mjs
  curl -s http://127.0.0.1:8960/health        # ok
Requires Node 18+ (no dependencies). Binds 127.0.0.1 only.

TEST
  sh services/trustweb-backup/test/run_tests.sh
Typechecks backup.ts with apps/demo's tsc, compiles it to a temp dir, runs node --test
(17 tests: crypto unit tests, and the server on an ephemeral port). Nothing is left running.

PRODUCTION (questhub, installed by the orchestrator)
  Copy server.mjs to /opt/trustweb-backup/server.mjs, then:

  /etc/systemd/system/trustweb-backup.service
    [Unit]
    Description=TrustWeb encrypted backup store
    After=network.target

    [Service]
    ExecStart=/usr/bin/node /opt/trustweb-backup/server.mjs
    Environment=HOST=127.0.0.1
    Environment=PORT=8960
    Environment=BACKUP_DIR=/var/lib/trustweb-backup
    Environment=ALLOWED_HOSTS=app.idea2.site
    DynamicUser=yes
    StateDirectory=trustweb-backup
    StateDirectoryMode=0700
    Restart=on-failure
    NoNewPrivileges=yes
    ProtectSystem=strict
    ProtectHome=yes
    PrivateTmp=yes
    PrivateDevices=yes
    ProtectKernelTunables=yes
    ProtectControlGroups=yes
    RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
    MemoryMax=256M

    [Install]
    WantedBy=multi-user.target

  systemctl daemon-reload && systemctl enable --now trustweb-backup
  (AlmaLinux: if SELinux blocks the node binary under /opt, label it or run from a path the policy allows.)

  Caddyfile, inside the app.idea2.site site block:
    handle /backup/* {
        request_body {
            max_size 1100KB
        }
        reverse_proxy 127.0.0.1:8960
    }
  Caddy keeps the original Host header (app.idea2.site) and sets X-Forwarded-For; the server
  trusts the last X-Forwarded-For entry only when the socket peer is loopback. Do not log
  request bodies or the /backup/ paths in the Caddy access log (the id is a secret).
