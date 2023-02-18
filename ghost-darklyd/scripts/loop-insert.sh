#!/bin/bash

function mysql () {
	docker-compose exec primary mysql -uroot -pmysql "$@"
}

while true; do
	url="https://example.com/$(uuidgen)"
	mysql linkdarkly -e "INSERT INTO links(url) VALUES('$url'); select * from links where id=LAST_INSERT_ID()\\G"
	sleep 1
done
