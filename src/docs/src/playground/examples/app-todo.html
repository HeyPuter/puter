<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>To-Do List App</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            text-align: center;
            padding: 10px;
        }

        .todo-container {
            background: white;
            margin: auto;
            width: 80%;
            padding: 20px;
            box-shadow: 0 0 10px 0 rgba(0, 0, 0, 0.1);
            max-width: 600px;
            position: relative;
        }

        #username {
            position: absolute;
            top: 0px;
            left: 20px;
        }

        #todo-list {
            list-style-type: none;
            padding: 0;
        }

        #todo-list li {
            padding: 10px;
            border-bottom: 1px solid #ddd;
            cursor: pointer;
        }

        #todo-list li:last-child {
            border-bottom: none;
        }

        #todo-list li.completed {
            text-decoration: line-through;
            color: #888;
        }
    </style>
    <script src="https://js.puter.com/v2/"></script>
</head>

<body>
    <div class="todo-container">
        <h1 style="margin-top:40px;">My To-Do List</h1>
        <p id="username"></p>
        <input type="text" id="todo-input" placeholder="Add a new task...">
        <button id="add-todo">Add</button>
        <button id="clear-all">Clear All</button>

        <ul id="todo-list"></ul>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', async () => {
            let user;

            // When user logs in, print their username
            puter.onAuth = async (user) => {
                // print the user's username
                const username = document.getElementById('username');
                username.textContent = `Welcome, ${user.username}`;
            };

            // Try to get the user from the session
            try {
                user = await puter.getUser();
                // print the user's username
                const username = document.getElementById('username');
                username.textContent = `Welcome, ${user.username}`;
            } catch (e) {
            }

            const addButton = document.getElementById('add-todo');
            const inputField = document.getElementById('todo-input');
            const todoList = document.getElementById('todo-list');

            // Load todos from the Puter Key-Value Store
            const todos = JSON.parse(await puter.kv.get('todos') ?? null) || [];
            todos.forEach(todo => addTodoElement(todo));

            addButton.addEventListener('click', () => {
                const todoText = inputField.value.trim();
                if (todoText) {
                    const todo = { text: todoText, completed: false };
                    addTodoElement(todo);
                    saveTodo(todo);
                    inputField.value = '';
                }
            });

            const clearAllButton = document.getElementById('clear-all');

            clearAllButton.addEventListener('click', async () => {
                todoList.innerHTML = ''; // Clear the list on the page
                await puter.kv.del('todos'); // Clear the todos
            });

            todoList.addEventListener('click', (event) => {
                if (event.target.tagName === 'LI') {
                    event.target.classList.toggle('completed');
                    updateList();
                }
            });

            function addTodoElement(todo) {
                const li = document.createElement('li');
                li.textContent = todo.text;
                if (todo.completed) {
                    li.classList.add('completed');
                }
                todoList.appendChild(li);
            }

            function saveTodo(todo) {
                todos.push(todo);
                updateList();
            }

            async function updateList() {
                const updatedTodos = [...todoList.children].map(li => {
                    return { text: li.textContent, completed: li.classList.contains('completed') };
                });
                await puter.kv.set('todos', JSON.stringify(updatedTodos));
            }
        });
    </script>
</body>

</html>