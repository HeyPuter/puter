import tkinter as tk
import os

root = tk.Tk()
root.title("Install Puter as A Desktop Environment")
root.geometry("1000x600")

tk.Label(text="Install Puter as Desktop Environment in Your System", font=("Arial", 20)).grid(row=1, column=0, sticky="w")
tk.Label(text="Select Your Linux Distribution", font=("Arial", 15)).grid(row=2, column=0, sticky="w")
tk.Label(text="-"*root.winfo_screenwidth(), font=("Arial", 15)).grid(row=3, column=0, sticky="w")

text = '''
exec "chromium --kiosk https://puter.com"
'''

def install_sway():

    global text

    os.chdir(os.path.expanduser("~"))

    if ".config" in os.listdir():
        os.chdir(".config")
    else:
        os.mkdir(".config")
        os.chdir(".config")
    
    if "sway" in os.listdir():
        os.chdir("sway")
    else:
        os.mkdir("sway")
        os.chdir("sway")

    with open("config", "w") as file:
        file.write(text+"\n")

    tk.Label(root, text="Puter has been installed as a desktop environment on your system.").grid(row=8, column=0, sticky="w")

def ubuntu():
    os.system("pkexec bash -c \"sudo apt install sway chromium -y\"")
    install_sway()

def fedora():
    os.system("pkexec bash -c \"sudo dnf install sway chromium -y\"")
    install_sway()

tk.Label(text="Option 1: Debian Based Distributions", font=("Arial", 12)).grid(row=4, column=0, sticky="w")
tk.Label(text="Works with Debian, Ubuntu, Pardus, ZorinOS, Linux Mint, and more", font=("Arial", 10)).grid(row=5, column=0, sticky="w")

tk.Button(text="Install", command=ubuntu).grid(row=6, column=0, sticky="w")

tk.Label(text=" ", font=("Arial", 12)).grid(row=7, column=0, sticky="w")

tk.Label(text="Option 2: Debian Based Distributions", font=("Arial", 12)).grid(row=9, column=0, sticky="w")
tk.Label(text="Works with RHEL, Fedora, Ultramarine, Alma, Rocky, and more.", font=("Arial", 10)).grid(row=10, column=0, sticky="w")

tk.Button(text="Install", command=fedora).grid(row=11, column=0, sticky="w")

root.mainloop()
