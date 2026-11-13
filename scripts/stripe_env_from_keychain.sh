# SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
# Local run only: export Jakob's Stripe TEST keys from the Mac Keychain into THIS shell, then start the server from it.
#   . scripts/stripe_env_from_keychain.sh && node services/trustweb-backup/server.mjs
# Items: service questhub-stripe-test (secret key) and questhub-stripe-test-pk (publishable key).
# It prints no value, ever; a missing item exports nothing and returns non-zero. Never commit, log or echo what it exports.
_tw_stripe_get() { security find-generic-password -s "$1" -w 2>/dev/null; }
_tw_sk=$(_tw_stripe_get questhub-stripe-test) || { echo "stripe_env_from_keychain: Keychain item questhub-stripe-test is missing" >&2; unset _tw_sk; return 1 2>/dev/null; }
_tw_pk=$(_tw_stripe_get questhub-stripe-test-pk) || { echo "stripe_env_from_keychain: Keychain item questhub-stripe-test-pk is missing" >&2; unset _tw_sk _tw_pk; return 1 2>/dev/null; }
export STRIPE_SECRET_KEY="$_tw_sk" STRIPE_PUBLISHABLE_KEY="$_tw_pk"
unset _tw_sk _tw_pk
unset -f _tw_stripe_get
