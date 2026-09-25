Put the real live definitions here (output of `../live-schema-export.sql`,
result 1, as `functions.sql`). When any `*.sql` file exists in this folder,
`../run.sh` applies it after `../live-baseline/`, replacing its placeholder functions, so the release migration is tested against the actual
live bodies of `update_print_spec`, `review_print_price`, the `*_with_margin`
RPCs and the guard triggers.
