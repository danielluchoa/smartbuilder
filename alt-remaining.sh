#!/bin/bash
set -e
cd /opt/smartbuilder/smartbuilder-deploy
M(){ docker compose exec -T -e MYSQL_PWD db mysql -uroot smartbuilder -e "$1"; }
while IFS=: read t c y; do M "ALTER TABLE $t MODIFY $c $y NULL;"; done <<'E'
projects:scope:TEXT
projects:address:TEXT
jobs:scope:TEXT
job_tasks:notes:TEXT
task_photos:photo_url:LONGTEXT
timesheets:note:TEXT
progress_updates:note:TEXT
progress_updates:photo_url:LONGTEXT
project_plans:file_data:LONGTEXT
project_plans:thumbnail_data:LONGTEXT
expenses:receipt_note:TEXT
invoice_items:description:TEXT
notifications:detail:TEXT
notifications:payload:TEXT
vehicles:photo_url:LONGTEXT
vehicle_maintenance:receipt_note:TEXT
vehicle_tickets:description:TEXT
entries:text:TEXT
E
echo ALTERS_DONE
docker compose exec -T app bun run seed
M 'SELECT COUNT(*) AS companies FROM companies;'
echo SCRIPT_DONE
