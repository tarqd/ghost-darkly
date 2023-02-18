#!/bin/bash

#export LD_SDK_KEY=
#export GHOST_SUCCESS_URL=
export PIDFILE=/tmp/launchdarkly-ghost.pid
export LOGFILE=/tmp/launchdarkly-ghost.log
export GHOST_SOCK=/tmp/ghost.sock
export POSTPONE_FLAG=/tmp/postpone.flag
export THROTTLE_FLAG=/tmp/throttle.flag

./bin/gh-ost --hooks-hint="Add expiry date to links" \
--hooks-path=./ghost-hooks.d \
--postpone-cut-over-flag-file=$POSTPONE_FLAG \
--throttle-flag-file=$THROTTLE_FLAG \
--hooks-hint="Add expiry date to links" \
--max-load=Threads_running=10 \
--critical-load=Threads_running=100 \
--chunk-size=5 \
--max-lag-millis=1500 \
--user="root" \
--password="mysql" \
--host=127.0.0.1 \
--allow-on-master \
--database="linkdarkly" \
--table="links" \
--verbose \
--alter='add column expires_at timestamp null default null' \
--switch-to-rbr \
--allow-master-master \
--cut-over=default \
--exact-rowcount \
--concurrent-rowcount \
--default-retries=120 "$@"