all: build

build:
	docker build -t dial-chat-themes  .

run:
	docker run -p 127.0.0.1:80:8080/tcp dial-chat-themes

help:
	@echo '===================='
	@echo 'build                        - build docker image'
	@echo 'test                         - run docker image'
