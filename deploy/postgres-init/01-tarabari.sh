#!/bin/sh
# First start of an empty volume only: Transport is POSTGRES_DB; Tarabari is made here.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c 'CREATE DATABASE "Tarabari"'
