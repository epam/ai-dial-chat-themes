all: lint build

build:
	docker build -t dial-chat-themes .

run:
	docker run -p 127.0.0.1:8080:8080/tcp dial-chat-themes

lint:
	docker run --rm -i hadolint/hadolint < Dockerfile

help:
	@echo '===================='
	@echo 'lint                         - lint the Dockerfile'
	@echo 'build                        - build docker image'
	@echo 'run                          - run docker image'