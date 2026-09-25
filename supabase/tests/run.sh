#!/usr/bin/env bash
# ============================================================
# Chạy schema.sql trên Postgres cục bộ (giả lập tối thiểu Supabase) rồi
# chạy kiểm thử phân quyền + duyệt báo cáo. KHÔNG đụng project thật.
#
# Cần: Postgres 14+ đang chạy, biến PGHOST/PGPORT/PGUSER trỏ tới nó.
#   bash supabase/tests/run.sh
# Đọc kết quả: mỗi dòng "(phải lỗi)" phải kèm ERROR ngay sau; các dòng
# còn lại không được có ERROR.
# ============================================================
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
DB="${TEST_DB:-mda_test}"

psql -q -c "drop database if exists $DB" -c "create database $DB"
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/shim.sql" >/dev/null 2>&1

# pg_cron / pg_net không có ở máy test — bỏ dòng create extension (shim giả lập cron.schedule)
SCHEMA="$(mktemp)"
sed -e 's/^create extension if not exists pg_cron;/-- (test) pg_cron/' "$DIR/../schema.sql" > "$SCHEMA"

echo "== Áp schema lần 1"; psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$SCHEMA" >/dev/null
echo "== Áp schema lần 2 (phải idempotent)"; psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$SCHEMA" >/dev/null
rm -f "$SCHEMA"

echo "== Kiểm thử"
psql -q -d "$DB" -f "$DIR/rls_test.sql" 2>&1 | grep -v '^$'
