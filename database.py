import json
import os
import winreg
import re

from config import settings, tr


class DataBase():
    def __init__(self):
        self.duplicate_symbol = "#"  # additional symbols: "_" -> ": ", "^" -> "?"
        self.user_name = os.getlogin()
        self.steamUserID = []
        self.ubisoftUserID = []
        self.systemPath = {
            "Windows": -1,
            "Registry": -1,
            "Steam": None,
            "Ubisoft": None
        }
        self.minecraft = ["Minecraft_Bedrock Edition",
                          "Minecraft_Java Edition"]
        self.gdMusic = ("Windows", "Folder",
                        "C:/Users/{self.user_name}/AppData/Local/GeometryDash")
        
        # games where saves are under their install location; or special patterns
        # key names should match with game names in self.gameSaveDirectory
        # if value is [], it has a format of [root_path, path, path, ...]
        # for games saved under install location, value should set to "" if game not found
        # for game saves with special patterns and NOT under install location, value should set to the actual path
        self.gamePath = {
            "A Dance of Fire and Ice": "",
            "AI＊Shoujo": "",
            "Besiege": "",
            "Big Money!": "",
            "Broforce": "",
            "Celeste": "",
            "Chuzzle": "",
            "Firework (2021)": "",
            "Geometry Dash": [],
            "Half-Life 2": "",
            "Inscryption": "",
            "Kaiju Princess": [],
            "Lies of P": "",
            "Little Nightmares": "",
            "Melatonin": "",
            "Minecraft Legends": [],
            "Portal": "",
            "Portal 2": "",
            "Portal with RTX": "",
            "Rhythm Doctor": "",
            "Saints Row": "",
            "Sanfu": "",
            "The Binding of Isaac": "",
            "Titan Souls": "",
            "Touhou Makuka Sai ~ Fantasy Danmaku Festival": "",
            "Touhou Makuka Sai ~ Fantasy Danmaku Festival" + self.duplicate_symbol: [],
            "Vampire Survivors": "",
            "Vampire Survivors" + self.duplicate_symbol: [],
            "Yomawari_Midnight Shadows": "",
        }

        self.find_steam_directory()
        self.find_ubisoft_directory()

        # self.instal_loc_save_path parameters: (game name, steam app id, subfolder after "steamapps/common/")
        self.gamePath["A Dance of Fire and Ice"] = self.install_loc_save_path(977950, "A Dance of Fire and Ice")
        self.gamePath["AI＊Shoujo"] = self.install_loc_save_path(1250650, "AI-Shoujo")
        self.gamePath["Besiege"] = self.install_loc_save_path(346010, "Besiege")
        self.gamePath["Big Money!"] = self.install_loc_save_path(3360, "Big Money Deluxe")
        self.gamePath["Broforce"] = self.install_loc_save_path(274190, "Broforce")
        self.gamePath["Celeste"] = self.install_loc_save_path(504230, "Celeste")
        self.gamePath["Chuzzle"] = self.install_loc_save_path(3310, "Chuzzle Deluxe")
        self.gamePath["Firework (2021)"] = self.install_loc_save_path(1288310, "Firework")
        self.gamePath["Geometry Dash"] = self.geometrydash()
        self.gamePath["Half-Life 2"] = self.install_loc_save_path(220, "Half-Life 2")
        self.gamePath["Inscryption"] = self.install_loc_save_path(1092790, "Inscryption")
        self.gamePath["Kaiju Princess"] = self.kaiju_princess(self.install_loc_save_path(1732180, "KaijuPrincess"))
        self.gamePath["Lies of P"] = self.install_loc_save_path(1627720, "Lies of P")
        self.gamePath["Little Nightmares"] = self.install_loc_save_path(424840, "Little Nightmares")
        self.gamePath["Melatonin"] = self.install_loc_save_path(1585220, "Melatonin")
        self.gamePath["Minecraft Legends"] = self.minecraft_legends()
        self.gamePath["Portal"] = self.install_loc_save_path(400, "Portal")
        self.gamePath["Portal 2"] = self.install_loc_save_path(620, "Portal 2")
        self.gamePath["Portal with RTX"] = self.install_loc_save_path(2012840, "PortalRTX")
        self.gamePath["Rhythm Doctor"] = self.install_loc_save_path(774181, "Rhythm Doctor")
        self.gamePath["Saints Row"] = self.install_loc_save_path(742420, "Saints Row")
        self.gamePath["Sanfu"] = self.sanfu()
        self.gamePath["The Binding of Isaac"] = self.install_loc_save_path(113200, "The Binding Of Isaac")
        self.gamePath["Titan Souls"] = self.install_loc_save_path(297130, "Titan Souls")
        self.gamePath["Touhou Makuka Sai ~ Fantasy Danmaku Festival"] = self.install_loc_save_path(882710, "TouHou Makuka Sai ~ Fantastic Danmaku Festival")
        self.gamePath["Touhou Makuka Sai ~ Fantasy Danmaku Festival" + self.duplicate_symbol] = self.tmsfdf()
        self.gamePath["Vampire Survivors"] = self.install_loc_save_path(1794680, "Vampire Survivors")
        self.gamePath["Vampire Survivors" + self.duplicate_symbol] = self.vampire_survivors()
        self.gamePath["Yomawari_Midnight Shadows"] = self.install_loc_save_path(625980, "Yomawari Midnight Shadows")

        # Format: "Game Name": ("Save Location", "Save Data Type", "Save Path")
        # Template "": ("", "", ""),
        # If game has multiple save paths, create another entry appending "self.duplicate_symbol" at the end
        self.gameSaveDirectory = {
            "20 Small Mazes": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/Godot/app_userdata/20 Small Mazes/Saves"),
            "64.0": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/rebelrabbit/64_0"),
            "A Dance of Fire and Ice": ("Windows", "Folder", "{self.gamePath['A Dance of Fire and Ice']}/User"),
            "A Plague Tale_Innocence": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/752590/remote"),
            "A Plague Tale_Requiem": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1182900/remote"),
            "A Way Out": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/My Games/A Way Out/Saves"),
            "Abzû": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/AbzuGame/Saved/SaveGames"),
            "AI＊Shoujo": ("Windows", "Folder", "{self.gamePath['AI＊Shoujo']}/UserData/save"),
            "Alba_A Wildlife Adventure": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/ustwo games/Alba/SaveFiles"),
            "Angry Birds Space": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/210550/remote"),
            "Anno 1800": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Anno 1800/accounts"),
            "Arrow a Row": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Lonerangerix/Arrow a Row"),
            "Assassin's Creed Odyssey": ("Ubisoft", "Folder", "{self.systemPath['Ubisoft']}/savegames/<user-id>/5092"),
            "Assassin's Creed Origins": ("Ubisoft", "Folder", "{self.systemPath['Ubisoft']}/savegames/<user-id>/4923"),
            "Assassin's Creed Valhalla": ("Ubisoft", "Folder", "{self.systemPath['Ubisoft']}/savegames/<user-id>/7013"),
            "Asterigos_Curse of the Stars": ("Windows", "Folder", "C:/Users/{self.user_name}/Saved Games/AcmeGS/Asterigos/Saved/SaveGames"),
            "Astroneer": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Astro/Saved/SaveGames"),
            "Atomic Heart": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/AtomicHeart/Saved/SaveGames"),
            "Avicii Invector": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Hello There Games/AVICII Invector"),
            "Baba Is You": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/Baba_Is_You"),
            "Bad North": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/688420/remote"),
            "Badland_Game of the Year Edition": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/BADLAND/data"),
            "Baldur's Gate 3": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1086940/remote"),
            "Baldur's Gate 3" + self.duplicate_symbol: ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Larian Studios/Baldur's Gate 3/PlayerProfiles/Public/Savegames/Story"),
            "Beat Hazard": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/49600/remote"),
            "Bejeweled": ("Windows", "Folder", "C:/ProgramData/Steam/Bejeweled/userdata"),
            "Bejeweled 2": ("Windows", "Folder", "C:/ProgramData/Steam/Bejeweled2/users"),
            "Bejeweled 3": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Steam/Bejeweled3/users"),
            "Bejeweled Twist": ("Windows", "Folder", "C:/ProgramData/Steam/BejeweledTwist/users"),
            "BattleBlock Theater": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/238460/remote"),
            "Besiege": ("Windows", "File", "{self.gamePath['Besiege']}/Besiege_Data/CompletedLevels.txt"),
            "Besiege" + self.duplicate_symbol: ("Windows", "Folder", "{self.gamePath['Besiege']}/Besiege_Data/SavedMachines"),
            "Big Money!": ("Windows", "File", "{self.gamePath['Big Money!']}/savegame.dat"),
            "Biomutant": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Biomutant/Saved/SaveGames"),
            "Biped": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/NExTStudios/Biped"),
            "Blasphemous": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/TheGameKitchen/Blasphemous/Savegames"),
            "Blazing Beaks": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/BlazingBeaks"),
            "Bloons TD 6": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/960090"),
            "Borderlands 3": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/My Games/Borderlands 3/Saved/SaveGames"),
            "Bright Memory_Infinite": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/BrightMemoryInfinite/Saved/SaveGames"),
            "Broforce": ("Windows", "Folder", "{self.gamePath['Broforce']}/Saves"),
            "Brotato": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/Brotato"),
            "Candleman_The Complete Journey": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/591630/remote"),
            "Celeste": ("Windows", "Folder", "{self.gamePath['Celeste']}/Saves"),
            "Child of Light": ("Ubisoft", "Folder", "{self.systemPath['Ubisoft']}/savegames/<user-id>/611"),
            "Chuzzle": ("Windows", "Folder", "{self.gamePath['Chuzzle']}/Profiles"),
            "Cocoon": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/GeometricInteractive/Cocoon"),
            "Command & Conquer Remastered Collection": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1213210/remote"),
            "Command & Conquer Remastered Collection" + self.duplicate_symbol: ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/CnCRemastered/Save"),
            "Control": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/870780/remote"),
            "Cookie Clicker": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1454400/remote"),
            "Core Keeper": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Pugstorm/Core Keeper/Steam"),
            "Crash Bandicoot 4_It's About Time": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/CrashBandicoot4/Saved/SaveGames"),
            "Creaks": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Amanita Design/Creaks/save"),
            "Creepy Tale": ("Windows", "File", "C:/Users/{self.user_name}/AppData/LocalLow/DeqafStudio/CreepyTale/playerData.deq"),
            "Crypt of the NecroDancer": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/247080/remote"),
            "Cube Escape Collection": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Rusty Lake/CubeEscapeCollection"),
            "Cube Escape_Paradox": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Rusty Lake/Paradox"),
            "Cult of the Lamb": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Massive Monster/Cult Of The Lamb/saves"),
            "Cuphead": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/Cuphead"),
            "Cyberpunk 2077": ("Windows", "Folder", "C:/Users/{self.user_name}/Saved Games/CD Projekt Red/Cyberpunk 2077"),
            "Dark Deception": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/DDeception/Saved/SaveGames"),
            "Dark Souls III": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/DarkSoulsIII"),
            "Darkwood": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Acid Wizard Studio/Darkwood"),
            "Dave the Diver": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/nexon/DAVE THE DIVER/SteamSData"),
            "Days Gone": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/BendGame/Saved"),
            "Dead Cells": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/588650/remote"),
            "Dead Space (2023)": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Dead Space (2023)/settings/steam"),
            "Death Stranding": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/KojimaProductions/DeathStranding"),
            "Death Stranding_Director's Cut": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/KojimaProductions/DeathStrandingDC"),
            "Deathloop": ("Windows", "Folder", "C:/Users/{self.user_name}/Saved Games/Arkane Studios/Deathloop/base/savegame"),
            "Death's Door": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Acid Nerve/DeathsDoor/SAVEDATA"),
            "Deiland": ("Registry", "None", "HKEY_CURRENT_USER\\Software\\Chibig\\Deiland"),
            "Demon Slayer -Kimetsu no Yaiba- The Hinokami Chronicles": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/APK/Saved/SaveGames"),
            "Detroit_Become Human": ("Windows", "Folder", "C:/Users/{self.user_name}/Saved Games/Quantic Dream/Detroit Become Human"),
            "Deus Ex_Mankind Divided": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/337000/remote"),
            "Devil May Cry 5": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/601150/remote/win64_save"),
            "Don't Starve Together": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Klei/DoNotStarveTogether"),
            "Doom Eternal": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/782330/remote"),
            "Dragon Age_Inquisition": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/BioWare/Dragon Age Inquisition/Save"),
            "DREDGE": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Black Salt Games/DREDGE/saves"),
            "Duck Game": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/312530/remote/"),
            "Dying Light": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/239140/remote/out"),
            "Dying Light 2 Stay Human": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/534380/remote/out"),
            "EA Sports FIFA 23": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/FIFA 23/settings"),
            "EA Sports PGA Tour": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/PGA TOUR/settings"),
            "Elden Ring": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/EldenRing"),
            "Element TD 2": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Element Studios/Element TD 2"),
            "Emily Wants to Play": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/EmilyWantsToPlay/Saved/SaveGames"),
            "Emily Wants to Play Too": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/EWTP_Too/Saved/SaveGames"),
            "Enter the Gungeon": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Dodge Roll/Enter the Gungeon"),
            "F1 22": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1692250/remote"),
            "Far Cry 4": ("Ubisoft", "Folder", "{self.systemPath['Ubisoft']}/savegames/<user-id>/856"),
            "Far Cry 5": ("Ubisoft", "Folder", "{self.systemPath['Ubisoft']}/savegames/<user-id>/4311"),
            "Far Cry 6": ("Ubisoft", "Folder", "{self.systemPath['Ubisoft']}/savegames/<user-id>/920"),
            "Far Cry New Dawn": ("Ubisoft", "Folder", "{self.systemPath['Ubisoft']}/savegames/<user-id>/5211"),
            "Feeding Frenzy 2": ("Registry", "None", "HKEY_CURRENT_USER\\Software\\GameHouse\\Feeding Frenzy 2"),
            "Feist": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/327060/remote"),
            "Final Fantasy VII Remake Intergrade": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/My Games/FINAL FANTASY VII REMAKE/Steam"),
            "Fireboy & Watergirl_Elements": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/com.osloalbet.fb"),
            "Fireboy & Watergirl_Fairy Tales": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/com.osloalbet.fairies"),
            "Firework (2021)": ("Windows", "Folder", f'{self.gamePath["Firework (2021)"]}/www/save'),
            "Five Nights at Freddy's": ("Windows", "File", "C:/Users/{self.user_name}/AppData/Roaming/MMFApplications/freddy"),
            "Five Nights at Freddy's 2": ("Windows", "File", "C:/Users/{self.user_name}/AppData/Roaming/MMFApplications/freddy2"),
            "Five Nights at Freddy's 3": ("Windows", "File", "C:/Users/{self.user_name}/AppData/Roaming/MMFApplications/freddy3"),
            "Five Nights at Freddy's 4": ("Windows", "File", "C:/Users/{self.user_name}/AppData/Roaming/MMFApplications/fn4"),
            "Five Nights at Freddy's_Sister Location": ("Windows", "File", "C:/Users/{self.user_name}/AppData/Roaming/MMFApplications/sl"),
            "Forza Horizon 4": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1293830/remote"),
            "Forza Horizon 5": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1551360/remote"),
            "Freddy Fazbear's Pizzeria Simulator": ("Windows", "File", "C:/Users/{self.user_name}/AppData/Roaming/MMFApplications/FNAF6"),
            "Frostpunk": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/323190/remote"),
            "Genital Jousting": ("Windows", "File", "C:/Users/{self.user_name}/AppData/LocalLow/Free Lives/Genital Jousting/Profile.penis"),
            "Geometry Dash": ("Windows", "File", self.gamePath["Geometry Dash"]),
            "Getting Over It with Bennett Foddy": ("Registry", "None", "HKEY_CURRENT_USER\\Software\\Bennett Foddy\\Getting Over It"),
            "Ghostrunner": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Ghostrunner/Saved/SaveGames"),
            "Goat Simulator": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/265930/remote"),
            "Goat Simulator 3": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Goat2/Saved/SaveGames"),
            "God of War": ("Windows", "Folder", "C:/Users/{self.user_name}/Saved Games/God of War"),
            "Gorogoa": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Annapurna/Gorogoa"),
            "Grand Theft Auto V": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Rockstar Games/GTA V/Profiles"),
            "Gris": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/nomada studio/GRIS"),
            "Grounded": ("Windows", "Folder", "C:/Users/{self.user_name}/Saved Games/Grounded"),
            "Hades": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Saved Games/Hades"),
            "Half-Life 2": ("Windows", "Folder", "{self.gamePath['Half-Life 2']}/hl2/save"),
            "Half-Life 2_Episode One": ("Windows", "Folder", "{self.gamePath['Half-Life 2']}/episodic/save"),
            "Half-Life 2_Episode Two": ("Windows", "Folder", "{self.gamePath['Half-Life 2']}/ep2/save"),
            "Halo Infinite": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1240440/remote"),
            "Hamster Playground": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1442670/remote"),
            "Handy Dandy": ("Windows", "File", "C:/Users/{self.user_name}/AppData/LocalLow/YellowBootsProduction/HandyDandyHandy2020/saveData.hds"),
            "Headbangers_Rhythm Royale": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Glee-Cheese Studio/Headbangers"),
            "Hellblade_Senua's Sacrifice": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/HellbladeGame/Saved/SaveGames"),
            "Hidden Folks": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Adriaan de Jongh/Hidden Folks"),
            "Hi-Fi RUSH": ("Windows", "Folder", "C:/Users/{self.user_name}/Saved Games/TangoGameworks/Hi-Fi RUSH (STEAM)/Saved/SaveGames"),
            "High on Life": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Oregon/Saved/SaveGames"),
            "Hitman": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/236870/remote"),
            "Hitman 2": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/863550/remote"),
            "Hitman 3": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1659040/remote"),
            "Hogwarts Legacy": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Hogwarts Legacy/Saved/SaveGames"),
            "Hollow Knight": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Team Cherry/Hollow Knight"),
            "Horizon Zero Dawn": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Horizon Zero Dawn/Saved Game"),
            "Hot Wheels Unleashed": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/hotwheels/Saved/SaveGames"),
            "Human_Fall Flat": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/477160/remote"),
            "Immortals Fenyx Rising": ("Ubisoft", "Folder", "{self.systemPath['Ubisoft']}/savegames/<user-id>/62326"),
            "Imprisoned Queen": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Playmeow/game"),
            "Influent": ("Registry", "None", "HKEY_CURRENT_USER\\Software\\ThreeFlipStudios\\Influent"),
            "Insaniquarium": ("Windows", "Folder", "C:/ProgramData/Steam/Insaniquarium/userdata"),
            "Inscryption": ("Windows", "File", "{self.gamePath['Inscryption']}/SaveFile.gwsave"),
            "Inside": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/304430/remote"),
            "Invisigun Reloaded": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Sombr Studio/Invisigun Reloaded"),
            "Isekai Frontline": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Studio Ginkgo/ISEKAI FRONTLINE"),
            "Isoland": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/CottonGame/Isoland_Steam/savedatas"),
            "Isoland 2_Ashes of Time": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/CottonGame/Isoland2_Steam"),
            "Isoland 3_Dust of the Universe": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/CottonGame/Isoland3_Steam"),
            "Isoland 4_The Anchor of Memory": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/CottonGame/Isoland4_Steam"),
            "Isoland_The Amusement Park": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/CottonGame/isoland0_Steam"),
            "It Takes Two": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/ItTakesTwo"),
            "Journey": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/638230/remote"),
            "Journey to the Savage Planet": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Towers/Saved/SaveGames"),
            "Jump Off The Bridge": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Jump_Off_The_Bridge"),
            "Jusant": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/ASC/Saved/SaveGames/FullGame"),
            "Just Cause 4": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/517630/remote"),
            "Just Go": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Studio Amateur/JustGo"),
            "Just Shapes & Beats": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/531510/remote"),
            "Kaiju Princess": ("Windows", "File", self.gamePath['Kaiju Princess']),
            "Kena_Bridge of Spirits": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Kena/Saved/SaveGames"),
            "Kingdom Rush_Vengeance": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Kingdom Rush Vengeance"),
            "KunKunNight": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/KunKunNight/Saved/SaveGames"),
            "Layers of Fear (2016)": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Bloober Team/Layers of Fear"),
            "Lego Star Wars_The Skywalker Saga": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/Warner Bros. Interactive Entertainment/LEGO Star Wars - The Skywalker Saga/SAVEDGAMES/STEAM"),
            "Leo's Fortune": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/355630/local"),
            "Lies of P": ("Windows", "Folder", "{self.gamePath['Lies of P']}/LiesofP/Saved/SaveGames"),
            "Life Is Strange": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/My Games/Life Is Strange/Saves"),
            "Life Is Strange" + self.duplicate_symbol: ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/319630/remote"),
            "Limbo": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/48000/remote"),
            "Little Nightmares": ("Windows", "Folder", "{self.gamePath['Little Nightmares']}/Atlas/Saved/SaveGames"),
            "Little Nightmares II": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Helios/Saved/SaveGames"),
            "Lobotomy Corporation": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Project_Moon/Lobotomy"),
            "Lost in Random": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Zoink Games/Lost In Random"),
            "Love Is All Around": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/yoogames-hd1-steam/LoveIsAllAround/SavesDir"),
            "Machinarium": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/40700/remote"),
            "Mad Max": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/234140/remote"),
            "Marvel's Avengers": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Marvel's Avengers"),
            "Marvel's Guardians of the Galaxy": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1088850/remote"),
            "Marvel's Spider-Man Remastered": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Marvel's Spider-Man Remastered"),
            "Melatonin": ("Windows", "File", "{self.gamePath['Melatonin']}/backup.json"),
            "Melatonin" + self.duplicate_symbol: ("Windows", "File", "{self.gamePath['Melatonin']}/LvlEditor_food.json"),
            "Melatonin" + self.duplicate_symbol*2: ("Windows", "File", "{self.gamePath['Melatonin']}/LvlEditor_stress.json"),
            "Melatonin" + self.duplicate_symbol*3: ("Windows", "File", "{self.gamePath['Melatonin']}/save.json"),
            "Metro Exodus": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1449560/remote"),
            "Microsoft Flight Simulator (2020)": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1250410/remote"),
            "Minecraft_Bedrock Edition": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Packages/Microsoft.MinecraftUWP_8wekyb3d8bbwe/LocalState/games/com.mojang"),
            "Minecraft Dungeons": ("Windows", "Folder", "C:/Users/{self.user_name}/Saved Games/Mojang Studios/Dungeons"),
            "Minecraft_Java Edition": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/.minecraft"),
            "Minecraft Legends": ("Windows", "Folder", self.gamePath["Minecraft Legends"]),
            "Minecraft_Story Mode - A Telltale Games Series": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Telltale Games/Minecraft Story Mode"),
            "Mini Metro": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/287980/remote"),
            "Moncage": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Optillusion/Moncage"),
            "Monster Hunter Rise": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1446780/remote"),
            "Monster Hunter Stories 2_Wings of Ruin": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1277400/remote"),
            "Monster Hunter_World": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/582010/remote"),
            "Monument Valley_Panoramic Edition": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/ustwo games/Monument Valley"),
            "Monument Valley 2_Panoramic Edition": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/ustwo games/Monument Valley 2"),
            "Muse Dash": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Steam/MuseDash"),
            "Mushroom 11": ("Registry", "None", "HKEY_CURRENT_USER\\Software\\Untame\\Mushroom 11"),
            "Mushroom 11" + self.duplicate_symbol: ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/243160/remote"),
            "My Time at Portia": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Pathea Games/My Time at Portia"),
            "My Time at Sandrock": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1084600/remote"),
            "Need for Speed Heat": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Need for Speed Heat/SaveGame/savegame"),
            "NieR_Automata": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/My Games/NieR_Automata"),
            "NieR Replicant": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/My Games/NieR Replicant ver.1.22474487139/Steam"),
            "No Man's Sky": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/HelloGames/NMS"),
            "No Rest for the Wicked": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Moon Studios/NoRestForTheWicked/DataStore"),
            "Noita": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Nolla_Games_Noita"),
            "Octopath Traveler": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/My Games/Octopath_Traveler"),
            "Operation_Tango": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Clever-Plays/Operation Tango"),
            "Ori and the Blind Forest": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Ori and the Blind Forest"),
            "Ori and the Blind Forest_Definitive Edition": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Ori and the Blind Forest DE"),
            "Ori and the Will of the Wisps": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Ori and the Will of The Wisps"),
            "Outlast": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/238320/remote"),
            "Outlast 2": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/414700/remote"),
            "Overcooked": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Ghost Town Games/Overcooked"),
            "Overcooked! 2": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Team17/Overcooked2"),
            "Oxygen Not Included": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Klei/OxygenNotIncluded"),
            "Overcooked! All You Can Eat": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Team17/Overcooked All You Can Eat"),
            "Pacify": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Pacify/Saved/SaveGames"),
            "Patrick's Parabox": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Patrick Traynor/Patrick's Parabox"),
            "Payday 2": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/218620/remote"),
            "Peggle": ("Windows", "Folder", "C:/ProgramData/Steam/Peggle/userdata"),
            "Peggle Extreme": ("Windows", "Folder", "C:/ProgramData/Steam/PeggleExtreme/userdata"),
            "Peggle Nights": ("Windows", "Folder", "C:/ProgramData/Steam/PeggleNights/userdata"),
            "Persona 5 Royal": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/SEGA/P5R/Steam"),
            "PGA Tour 2K21": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/2K/PGA TOUR 2K21"),
            "PGA Tour 2K23": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/My Games/PGA TOUR 2K23"),
            "PHOGS!": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/850320/remote"),
            "Pikuniku": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/572890/remote"),
            "Placid Plastic Duck Simulator": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Turbolento Games/Placid Plastic Duck Simulator"),
            "Plague Inc": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/246620/remote"),
            "Plants vs. Zombies": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/3590/remote"),
            "Poly Bridge": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/367450/remote"),
            "Poly Bridge 2": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Dry Cactus/Poly Bridge 2"),
            "Poly Bridge 3": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Dry Cactus/Poly Bridge 3"),
            "Polyball": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/368180/remote"),
            "Portal": ("Windows", "Folder", "{self.gamePath['Portal']}/portal/save"),
            "Portal 2": ("Windows", "Folder", "{self.gamePath['Portal 2']}/portal2/SAVE"),
            "Portal with RTX": ("Windows", "Folder", "{self.gamePath['Portal with RTX']}/portal_rtx/save"),
            "Raft": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Redbeet Interactive/Raft/User"),
            "RAGE 2": ("Windows", "Folder", "C:/Users/{self.user_name}/Saved Games/id Software/Rage 2/Saves"),
            "Ratchet & Clank_Rift Apart": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Ratchet & Clank - Rift Apart"),
            "Rayman Legends": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Rayman Legends"),
            "Red Dead Redemption 2": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Rockstar Games/Red Dead Redemption 2/Profiles"),
            "Resident Evil 4 (2023)": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/2050650/remote/win64_save"),
            "Resident Evil 7_Biohazard": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/418370/remote/win64_save"),
            "Resident Evil Village": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1196590/remote/win64_save"),
            "Returnal": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Returnal/Steam/Saved/SaveGames"),
            "Rhythm Doctor": ("Windows", "Folder", "{self.gamePath['Rhythm Doctor']}/User"),
            "Ride 4": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Ride4/Saved/SaveGames"),
            "Riders Republic": ("Ubisoft", "Folder", "{self.systemPath['Ubisoft']}/savegames/<user-id>/5780"),
            "Rise of the Tomb Raider": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/391220/remote"),
            "Risk of Rain 2": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/632360/remote/UserProfiles"),
            "Rolling Sky": ("Windows", "File", "C:/Users/{self.user_name}/AppData/LocalLow/Cheetah Mobile Inc/Rolling Sky/saveData.txt"),
            "Rolling Sky 2": ("Registry", "None", "HKEY_CURRENT_USER\\Software\\Cheetah Mobile Inc.\\RollingSky2"),
            "Rusty Lake Hotel": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Rusty Lake/Hotel"),
            "Rusty Lake Paradise": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Rusty Lake/Paradise"),
            "Rusty Lake_Roots": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/com.RustyLake.RustyLakeRoots/Local Store/#SharedObjects/RustyLakeRoots.sw"),
            "Sackboy_A Big Adventure": ("Windows", "Folder", "C:/Users/{self.user_name}/Saved Games/Sackboy/Steam/SaveGames"),
            "Saints Row": ("Windows", "Folder", "{self.gamePath['Saints Row']}/sr5/_cloudfolder/saves/SR"),
            "Samorost 3": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/Amanita-Design.Samorost3/Local Store"),
            "Samsara Room": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Rusty Lake/SamsaraRoom"),
            "Sanfu": ("Windows", "Folder", "{self.gamePath['Sanfu']}/www/save"),
            "Scarlet Maiden": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/OttersideGames/ScarletMaiden"),
            "Scorn": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Scorn/Saved/SaveGames"),
            "Sea of Stars": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Sabotage Studio/Sea of Stars"),
            "Sekiro_Shadows Die Twice": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/Sekiro"),
            "Shadow of the Tomb Raider": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Shadow of the Tomb Raider"),
            "Shadows_Awakening": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Games Farm/Shadows_ Awakening/saves"),
            "Shift Happens": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/359840/remote"),
            "Sid Meier's Civilization VI": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/My Games/Sid Meier's Civilization VI/Saves"),
            "Sifu": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Sifu/Saved/SaveGames"),
            "Skul_The Hero Slayer": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Southpaw Games/Skul"),
            "Slime Rancher": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Monomi Park/Slime Rancher"),
            "Slime Rancher 2": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/MonomiPark/SlimeRancher2"),
            "Song of Nunu_A League of Legends Story": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/SongOfNunu/Saved/SaveGames"),
            "Sonic Frontiers": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/SEGA/SonicFrontiers/steam"),
            "South Park_The Stick of Truth": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/My Games/South Park - The Stick of Truth/save"),
            "SpeedRunners": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/207140/remote"),
            "Spin Rhythm XD": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Super Spin Digital/Spin Rhythm XD"),
            "SpongeBob SquarePants_Battle for Bikini Bottom - Rehydrated": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Pineapple/Saved/SaveGames"),
            "Spore": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/Spore/Games"),
            "Spore" + self.duplicate_symbol: ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/My Spore Creations"),
            "Star Wars Battlefront II (2017)": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/STAR WARS Battlefront II/settings"),
            "Stardew Valley": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/StardewValley/Saves"),
            "Starfield": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1716740/remote/Saves"),
            # "Starlink_Battle for Atlas": ("Ubisoft", "Folder", ""), # incomplete
            "Steep": ("Ubisoft", "Folder", "{self.systemPath['Ubisoft']}/savegames/<user-id>/3280"),
            "Stray": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Hk_project/Saved/SaveGames"),
            "Super Bunny Man": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Catobyte/Super Bunny Man"),
            "Super Seducer": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/LaRuina/SuperSeducer"),
            "Super Seducer 2": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/LaRuina/SuperSeducer2"),
            "Superhot": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/SUPERHOT_Team/SUPERHOT"),
            "Superhot_Mind Control Delete": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/SUPERHOT_Team/SHMCD"),
            "Superliminal": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/PillowCastle/SuperliminalSteam/Clouds"),
            "Tales of Arise": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/BANDAI NAMCO Entertainment/Tales of Arise/Saved/SaveGames"),
            "Talismania": ("Registry", "None", "HKEY_CURRENT_USER\\Software\\GameHouse\\Talismania"),
            "Teardown": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Teardown"),
            "Terraria": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/My Games/Terraria"),
            "Terraria" + self.duplicate_symbol: ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/105600/remote"),
            "tERRORbane": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/BitNine Studio/tERRORbane"),
            "The Almost Gone": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Happy Volcano/The Almost Gone"),
            "The Amazing Spider-Man 2": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/267550/remote"),
            "The Beast Inside": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/TheBeastInside/Saved/SaveGames"),
            "The Binding of Isaac": ("Windows", "File", "{self.gamePath['The Binding of Isaac']}/serial.txt"),
            "The Binding of Isaac_Rebirth": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/250900/remote"),
            "The Forest": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/242760/remote"),
            "The Game of Life 2": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Marmalade Game Studio/Game Of Life 2"),
            "The Hunter_Call of the Wild": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Avalanche Studios/COTW/Saves"),
            "The Last Campfire": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Hello Games/The Last Campfire"),
            "The Last of Us Part I": ("Windows", "Folder", "C:/Users/{self.user_name}/Saved Games/The Last of Us Part I/users"),
            "The Medium": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Medium/Saved/SaveGames"),
            "The Outlast Trials": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/OPP/Saved/SaveGames"),
            "The Past Within": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/RustyLake/The Past Within/Serialization/SaveFiles"),
            "The Room": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/288160/remote"),
            "The Room Two": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Fireproof Games/The Room Two"),
            "The Room Three": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Fireproof Games/The Room Three"),
            "The Room 4_Old Sins": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Fireproof Studios/Old Sins"),
            "The Sims 4": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Electronic Arts/The Sims 4/saves"),
            "The Stanley Parable_Ultra Deluxe": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Crows Crows Crows/The Stanley Parable_ Ultra Deluxe"),
            "The Survivalists": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Team17 Digital Ltd_/The Survivalists"),
            "The White Door": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Rusty Lake/TheWhiteDoor"),
            "The Witcher 3_Wild Hunt": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/The Witcher 3"),
            "There Is No Game_Wrong Dimension": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/DrawMeAPixel/Ting"),
            "Titan Souls": ("Windows", "Folder", "{self.gamePath['Titan Souls']}/data/SAVE"),
            "Titanfall 2": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/Respawn/Titanfall2/profile/savegames"),
            "Tomb Raider (2013)": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/203160/remote"),
            "Tom Clancy's Ghost Recon Wildlands": ("Ubisoft", "Folder", "{self.systemPath['Ubisoft']}/savegames/<user-id>/3559"),
            "Touhou Makuka Sai ~ Fantasy Danmaku Festival": ("Windows", "File", "{self.gamePath['Touhou Makuka Sai ~ Fantasy Danmaku Festival']}/Content/Music/00.xna"),
            "Touhou Makuka Sai ~ Fantasy Danmaku Festival" + self.duplicate_symbol: ("Windows", "File", self.gamePath["Touhou Makuka Sai ~ Fantasy Danmaku Festival" + self.duplicate_symbol]),
            "Touhou Makuka Sai ~ Fantasy Danmaku Festival" + self.duplicate_symbol*2: ("Windows", "Folder", "{self.gamePath['Touhou Makuka Sai ~ Fantasy Danmaku Festival']}/Replay"),
            "Townscaper": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Oskar Stalberg/Townscaper/Saves"),
            "Trail Out": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/TrailOut/Saved/SaveGames"),
            # "Trials Rising": ("", "", ""), # incomplete
            "Trine 4_The Nightmare Prince": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/690640/remote"),
            "Trine 5_A Clockwork Conspiracy": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1436700/remote"),
            "Trombone Champ": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Holy Wow/TromboneChamp"),
            "Tunic": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Andrew Shouldice/Secret Legend/SAVES"),
            "Ultimate Chicken Horse": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Clever Endeavour Games/Ultimate Chicken Horse"),
            "Ultimate Custom Night": ("Windows", "File", "C:/Users/{self.user_name}/AppData/Roaming/MMFApplications/CN"),
            "Unbound_Worlds Apart": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Unbound/Saved/SaveGames"),
            "Uncharted_Legacy of Thieves Collection": ("Windows", "Folder", "C:/Users/{self.user_name}/Saved Games/Uncharted Legacy of Thieves Collection/users"),
            "Undertale": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/UNDERTALE"),
            "Unpacking": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1135690/remote"),
            "Unravel": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/Unravel"),
            "Unravel Two": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/UnravelTwo"),
            "Untitled Goose Game": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/House House/Untitled Goose Game"),
            "Vampire Survivors": ("Windows", "Folder", "{self.gamePath['Vampire Survivors']}/resources/app/.webpack/renderer"),
            "Vampire Survivors" + self.duplicate_symbol: ("Windows", "Folder", self.gamePath["Vampire Survivors" + self.duplicate_symbol]),
            "Vampire Survivors" + self.duplicate_symbol*2: ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1794680/remote"),
            "Virtual Cottage": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/Godot/app_userdata/Virtual Cottage"),
            "Watch Dogs": ("Ubisoft", "Folder", "{self.systemPath['Ubisoft']}/savegames/<user-id>/541"),
            "Watch Dogs 2": ("Ubisoft", "Folder", "{self.systemPath['Ubisoft']}/savegames/<user-id>/3619"),
            "Watch Dogs_Legion": ("Ubisoft", "Folder", "{self.systemPath['Ubisoft']}/savegames/<user-id>/7017"),
            "Weird RPG": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/DefaultCompany/Second/GameAutoCloud"),
            "What the Golf^": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Triband/WHAT THE GOLF_"),
            "while True_learn()": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/619150/remote"),
            "Wild Hearts": ("Windows", "Folder", "C:/Users/{self.user_name}/Documents/KoeiTecmo/WILD HEARTS"),
            "Witch It": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/WitchIt/Saved/SaveGames"),
            "Wizard of Legend": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/LocalLow/Contingent99/Wizard of Legend"),
            "Word Game": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/文字遊戲"),
            "World of Goo (2019)": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Local/2DBoy/WorldOfGoo"),
            "World War Z": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/699130/remote"),
            "Worms W.M.D": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/327030/remote"),
            "WWE 2K22": ("Steam", "Folder", "{self.systemPath['Steam']}/userdata/<user-id>/1255630/remote"),
            "Yakuza_Like a Dragon": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/SEGA/YakuzaLikeADragon"),
            "Yomawari_Lost in the Dark": ("Windows", "Folder", "C:/Users/{self.user_name}/AppData/Roaming/Nippon Ichi Software, Inc/Yomawari Lost In the Dark"),
            "Yomawari_Midnight Shadows": ("Windows", "Folder", "{self.gamePath['Yomawari_Midnight Shadows']}/savedata"),
            "Zuma": ("Windows", "Folder", "C:/ProgramData/Steam/Zuma/userdata"),
            "Zuma's Revenge!": ("Windows", "Folder", "C:/ProgramData/Steam/ZumasRevenge/users"),
        }

        if settings["backupGDMusic"]:
            self.gameSaveDirectory["Geometry Dash"] = self.gdMusic
        
        # converted_games = []
        # localizations = {item['en_US']: item for item in games}
        # for game_name, (platform, folder_or_file, path) in self.gameSaveDirectory.items():
        #     try:
        #         game_name = game_name.replace("_", ": ").replace("^", "?").rstrip(self.duplicate_symbol)
        #         game_info = {
        #             "en_US": localizations[game_name]["en_US"],
        #             "zh_CN": localizations[game_name]["zh_CN"],
        #             "save_paths": [
        #                 {
        #                     "save_loc": platform,
        #                     "root_path": self.convert_path(path),
        #                     "files": "all" if folder_or_file == "Folder" else "special files"
        #                 }
        #             ]
        #         }
        #         converted_games.append(game_info)

        #     except Exception as e:
        #         # General exception handling (unexpected issues)
        #         print(f"Unexpected error with {game_name}: {str(e)}")
        #         game_info = {
        #             "en_US": localizations.get(game_name, {}).get("en_US", "Unknown"),
        #             "zh_CN": localizations.get(game_name, {}).get("zh_CN", "Unknown"),
        #             "save_paths": []
        #         }
        #         converted_games.append(game_info)

        # # Output JSON
        # output_json = json.dumps({"games": converted_games}, indent=4, ensure_ascii=False)

        # # Optionally, write to a file
        # with open('game_saves_new.json', 'w', encoding='utf-8') as json_file:
        #     json_file.write(output_json)

    # ===========================================================================
    # Game specific save logic functions
    # ===========================================================================
    # def convert_path(self, path):
    #     path = path.replace("{self.user_name}", "{user_name}")
    #     path = path.replace("{self.systemPath['Steam']}", "{steam_path}")
    #     path = path.replace("{self.systemPath['Ubisoft']}", "{ubisoft_path}")
    #     return path

    def geometrydash(self):
        root = "C:/Users/{self.user_name}/AppData/Local/GeometryDash"
        result = [root]
        if os.path.exists(root):
            for dirname in os.listdir(root):
                if dirname.endswith(".dat"):
                    result.append(dirname)
        return result

    def kaiju_princess(self, path):
        root = os.path.join(path, "KaijuPrincess_Data")
        result = [root]
        pattern = re.compile(r"savefile\d+\.s")
        if os.path.exists(root):
            for dirname in os.listdir(root):
                if pattern.match(dirname):
                    result.append(dirname)
        return result

    def minecraft_legends(self):
        root = "C:/Users/{self.user_name}/AppData/Roaming/Minecraft Legends"
        result = [root]
        if os.path.exists(root):
            for dirname in os.listdir(root):
                if dirname not in ["internalStorage", "logs"]:
                    result.append(dirname)
        return result

    def sanfu(self):
        install_path = os.path.join(
            self.find_game_root_path(1880330), "steamapps/common/三伏")
        if os.path.exists(install_path):
            return install_path

        try:
            registry_key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 1880330")
            value, regtype = winreg.QueryValueEx(
                registry_key, "InstallLocation")
            winreg.CloseKey(registry_key)
            base_path = value[:value.rfind('\\') + 1]
            corrected_path = os.path.join(base_path, "三伏")
            return corrected_path
        except WindowsError:
            return ""

    def tmsfdf(self):
        root = os.path.join(
            self.gamePath["Touhou Makuka Sai ~ Fantasy Danmaku Festival"], "Content/Data")
        result = [root]
        if os.path.exists("{root}/4.xna"):
            result.append("4.xna")
        if os.path.exists("{root}/5.xna"):
            result.append("5.xna")
        if os.path.exists("{root}/8.xna"):
            result.append("8.xna")
        return result

    def vampire_survivors(self):
        root = "C:/Users/{self.user_name}/AppData/Roaming"
        result = [root]
        if os.path.exists(root):
            for dirname in os.listdir(root):
                if dirname.startswith("Vampire_Survivors"):
                    result.append(dirname)
        return result

    # ===========================================================================
    # General functions
    # ===========================================================================

    def find_steam_directory(self):
        try:
            registry_key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\WOW6432Node\\Valve\\Steam")
            value, regtype = winreg.QueryValueEx(registry_key, "InstallPath")
            winreg.CloseKey(registry_key)
            self.systemPath["Steam"] = value
        except WindowsError:
            self.systemPath["Steam"] = None

        if self.systemPath["Steam"] is None:
            self.insert_text(
                tr("Could not find Steam installation path\nGames saved under Steam directory will not be processed") + "\n\n")
            return False

        steamUserIDFolder = os.path.join(self.systemPath["Steam"], "userdata/")
        if os.path.exists(steamUserIDFolder):
            all_items = os.listdir(steamUserIDFolder)
            self.steamUserID = [item for item in all_items if os.path.isdir(
                os.path.join(steamUserIDFolder, item))]
            print("Steam user ids: ", self.steamUserID)

        return True

    def find_ubisoft_directory(self):
        try:
            registry_key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher")
            value, regtype = winreg.QueryValueEx(registry_key, "InstallDir")
            winreg.CloseKey(registry_key)
            self.systemPath["Ubisoft"] = value
        except WindowsError:
            self.systemPath["Ubisoft"] = None

        if self.systemPath["Ubisoft"] is None:
            self.insert_text(
                tr("Could not find Ubisoft installation path\nGames saved under Ubisoft directory will not be processed") + "\n\n")
            return False

        ubisoftUserIDFolder = os.path.join(
            self.systemPath["Ubisoft"], "savegames/")
        if os.path.exists(ubisoftUserIDFolder):
            all_items = os.listdir(ubisoftUserIDFolder)
            self.ubisoftUserID = [item for item in all_items if os.path.isdir(
                os.path.join(ubisoftUserIDFolder, item))]
            print("Ubisoft user ids: ", self.ubisoftUserID)

        return True

    def install_loc_save_path(self, steam_app_id, subfolder):
        install_path = os.path.join(self.find_game_root_path(
            steam_app_id), "steamapps/common/{subfolder}")
        if os.path.exists(install_path):
            return install_path

        try:
            registry_key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App {steam_app_id}")
            value, regtype = winreg.QueryValueEx(
                registry_key, "InstallLocation")
            winreg.CloseKey(registry_key)
            return value
        except WindowsError:
            return ""

    def find_game_root_path(self, id):
        if self.systemPath["Steam"]:
            steamVDF = os.path.join(
                self.systemPath["Steam"], "config/libraryfolders.vd")
        else:
            return ""

        if os.path.exists(steamVDF):
            with open(steamVDF, 'r') as file:
                file_content = file.read()
        else:
            return ""
        
        lines = file_content.splitlines()
        current_path = None
        game_dict = {}
        for line in lines:
            stripped_line = line.strip()
            if '"path"' in stripped_line:
                current_path = stripped_line.split()[-1].replace('"', '')
            if current_path and len(stripped_line.split()) == 2 and stripped_line.split()[0].replace('"', '').isnumeric():
                game_id = stripped_line.split()[0].replace('"', '')
                game_dict[game_id] = current_path

        return game_dict.get(str(id), "")

if __name__ == "__main__":
    DataBase()