FROM golang:1.25

WORKDIR /

COPY . .

RUN go build -o fs_tree_manager ./server.go

CMD ["./fs_tree_manager"]