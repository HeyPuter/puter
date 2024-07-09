#include <iostream>
#include <fstream>
#include <string>
#include <cstdio>
#include <cstdlib>
#include <unistd.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>

const char* PIPE_NAME = "/tmp/bash_pipe";

int         main()
{
    mkfifo(PIPE_NAME, 0666);

    while (true)
    {
        int pipe_fd = open(PIPE_NAME, O_RDONLY);
        if (pipe_fd == -1)
        {
            perror("open");
            exit(EXIT_FAILURE);
        }

        std::string command;
        char        buffer[128];
        ssize_t     bytes_read;
        while ((bytes_read = read(pipe_fd, buffer, sizeof(buffer))) > 0)
        {
            command.append(buffer, bytes_read);
        }
        close(pipe_fd);

        int pipe_to_child[2];
        int pipe_from_child[2];

        if (pipe(pipe_to_child) == -1 || pipe(pipe_from_child) == -1)
        {
            std::cerr << "Failed to create pipes\n";
            exit(EXIT_FAILURE);
        }

        pid_t pid = fork();

        if (pid < 0)
        {
            std::cerr << "Fork failed\n";
            exit(EXIT_FAILURE);
        }
        else if (pid == 0)
        {
            close(pipe_to_child[1]);
            close(pipe_from_child[0]);
            dup2(pipe_to_child[0], STDIN_FILENO);
            dup2(pipe_from_child[1], STDOUT_FILENO);
            execl("/bin/bash", "/bin/bash", "-i", nullptr);
            perror("exec");
            exit(EXIT_FAILURE);
        }
        else
        {
            close(pipe_to_child[0]);
            close(pipe_from_child[1]);
            write(pipe_to_child[1], command.c_str(), command.size());
            close(pipe_to_child[1]);
            char          output_buffer[128];
            ssize_t       output_bytes_read;
            std::ofstream pipe_out(PIPE_NAME, std::ofstream::trunc);
            while ((output_bytes_read =
                        read(pipe_from_child[0], output_buffer, sizeof(output_buffer))) > 0)
            {
                pipe_out.write(output_buffer, output_bytes_read);
            }
            close(pipe_from_child[0]);
            pipe_out.close();
        }
    }
    unlink(PIPE_NAME);

    return 0;
}
